/**
 * EKONOMI — API för den gemensamma ekonomiska uppföljningen.
 *
 * Åtkomst: inloggad användare som dessutom finns i EKONOMI_ALLOWED_USER_IDS
 * (kommaseparerade Clerk-användar-id). Saknas variabeln nekas alla i
 * produktion — ekonomidata ska inte vara öppen för alla som kan logga in.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../_lib/prisma.js';
import { getUserId } from '../_lib/auth.js';
import { asyncHandler, BadRequest, Forbidden, Unauthorized } from '../_lib/errors.js';
import { parseBody } from '../_lib/validation.js';
import { monthHash, STATUS_MEANING, verify } from '../_lib/ekonomi/checks.js';
import { authUrl, completeConnection, disconnect, envStatus, SCOPES, verifyState } from '../_lib/ekonomi/fortnox.js';
import { InternalTagger } from '../_lib/ekonomi/intercompany.js';
import { AccountMapper, CATEGORIES, CATEGORY_BY_ID, DEFAULT_RANGES } from '../_lib/ekonomi/mapping.js';
import { buildLedgerOverview, buildLiquidity } from '../_lib/ekonomi/overview.js';
import { addMonths, monthEnd, monthOf, monthStart, previousYear, resolvePeriod, type Period, type PeriodSpec } from '../_lib/ekonomi/periods.js';
import { buildBalanceReport, buildResultReport } from '../_lib/ekonomi/report.js';
import { loadConfig, loadDataset, loadFacts, saveConfig, saveFacts } from '../_lib/ekonomi/store.js';
import { syncCompany, type YearSelector } from '../_lib/ekonomi/sync.js';
import { buildTestDataset } from '../_lib/ekonomi/testdata.js';
import { COMPANIES, COMPANY_IDS, type CompanyId, type Dataset, type EkonomiConfig } from '../_lib/ekonomi/types.js';

const router = Router();
const companyEnum = z.enum(COMPANY_IDS);

// ── Schemalagd hämtning (Vercel Cron, skyddad av CRON_SECRET) ───────────────
router.get(
  '/cron-sync',
  asyncHandler(async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.authorization !== `Bearer ${secret}`) throw Unauthorized();
    const company = companyEnum.parse(req.query.company);
    const years = z.enum(['current', 'previous']).parse(req.query.years ?? 'current');
    const conn = await prisma.finConnection.findUnique({ where: { companyId: company } });
    if (!conn?.tokenEnc) return res.json({ skipped: 'ej ansluten' });
    res.json(await syncCompany(company, years, { ledger: years === 'current' }));
  })
);

// ── Åtkomstkontroll för allt annat ──────────────────────────────────────────
function requireEkonomiAccess(req: Request, _res: Response, next: NextFunction) {
  const userId = getUserId(req);
  if (!userId) return next(Unauthorized());
  const allowed = (process.env.EKONOMI_ALLOWED_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const isLocalDev = !process.env.VERCEL;
  // Testdata innehåller inga verkliga uppgifter och får visas för alla inloggade.
  const testOnly = req.method === 'GET' && req.query.source === 'test' && (req.path === '/overview' || req.path === '/transactions');
  if (!testOnly && (allowed.length ? !allowed.includes(userId) : !isLocalDev)) {
    return next(Forbidden(`Du saknar behörighet till ekonomiuppföljningen. Lägg till användar-id ${userId} i EKONOMI_ALLOWED_USER_IDS.`));
  }
  (req as any).userId = userId;
  next();
}
router.use(requireEkonomiAccess);
const uid = (req: Request) => (req as any).userId as string;

function periodSpec(q: Record<string, unknown>): PeriodSpec {
  const type = z.enum(['month', 'range', 'ytd', 'r12', 'fiscal']).parse(q.type ?? 'month');
  const today = new Date().toISOString().slice(0, 10);
  const s = (k: string) => (typeof q[k] === 'string' && q[k] ? (q[k] as string) : undefined);
  switch (type) {
    case 'month':
      return { type, month: s('month') ?? addMonths(monthOf(today), -1) };
    case 'range':
      if (!s('from') || !s('to')) throw BadRequest('from och to krävs');
      return { type, from: s('from')!, to: s('to')! };
    case 'ytd':
    case 'r12':
      return { type, asOf: s('asOf') ?? today };
    case 'fiscal':
      return { type, companyId: companyEnum.parse(q.company), asOf: s('asOf') ?? today };
  }
}

async function loadFor(source: string, period: Period, now: string): Promise<{ ds: Dataset; cfg: EkonomiConfig; ledgerLoaded: Record<CompanyId, boolean>; connected: Record<CompanyId, boolean> }> {
  if (source === 'test') return { ...buildTestDataset(now), connected: { stodona_ab: false, stodona_services: false } };
  // Jämförelseperioden (föregående år) och balansens räkenskapsår behöver också rymmas.
  const prev = previousYear(period);
  const [loaded, cfg] = await Promise.all([loadDataset({ from: prev.from, to: period.to }), loadConfig()]);
  return { ...loaded, cfg };
}

// ── Översikt: allt startsidan behöver för en vald period ────────────────────
router.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const now = new Date().toISOString();
    const source = req.query.source === 'test' ? 'test' : 'live';
    let spec = periodSpec(req.query as any);
    let fyList;
    if (spec.type === 'fiscal') {
      if (source === 'test') fyList = buildTestDataset(now).ds.companies[spec.companyId].fiscalYears;
      else fyList = (await prisma.finFiscalYear.findMany({ where: { companyId: spec.companyId } })).map((y) => ({ fyId: y.fyId, from: y.fromDate, to: y.toDate, importedAt: y.importedAt?.toISOString() ?? null }));
    }
    let period: Period;
    try {
      period = resolvePeriod(spec, fyList);
    } catch (e: any) {
      throw BadRequest(e.message);
    }
    const { ds, cfg, ledgerLoaded, connected } = await loadFor(source, period, now);
    const result = buildResultReport(ds, cfg, period, now);
    const previous = buildResultReport(ds, cfg, previousYear(period), now);
    const balance = buildBalanceReport(ds, cfg, period.to <= now.slice(0, 10) ? period.to : now.slice(0, 10));
    const verification = verify(ds, cfg, result, balance);
    res.json({
      source,
      isTestData: ds.isTestData,
      generatedAt: now,
      period,
      ownFiscalYearOnly: spec.type === 'fiscal' ? spec.companyId : null,
      result,
      previous: { period: previous.period, rows: previous.rows, completeness: previous.completeness },
      balance,
      liquidity: buildLiquidity(ds, cfg, period),
      ledger: buildLedgerOverview(ds, cfg, now.slice(0, 10), ledgerLoaded),
      verification,
      statusMeaning: STATUS_MEANING,
      companies: COMPANY_IDS.map((id) => ({
        ...COMPANIES[id],
        connected: connected[id],
        sync: ds.companies[id].sync,
        fiscalYears: ds.companies[id].fiscalYears,
        voucherCount: ds.companies[id].vouchers.length,
      })),
    });
  })
);

// ── Borrning: konto → transaktioner ─────────────────────────────────────────
router.get(
  '/transactions',
  asyncHandler(async (req, res) => {
    const q = z.object({ company: companyEnum, account: z.string().min(1), from: z.string(), to: z.string(), source: z.string().optional() }).parse(req.query);
    const now = new Date().toISOString();
    const period = resolvePeriod({ type: 'range', from: q.from, to: q.to });
    const { ds, cfg } = await loadFor(q.source === 'test' ? 'test' : 'live', period, now);
    const mapper = new AccountMapper(cfg.mappingOverrides);
    const tagger = new InternalTagger(ds, cfg.internalRules, mapper);
    const rows = [];
    for (const v of ds.companies[q.company].vouchers) {
      if (v.date < q.from || v.date > q.to) continue;
      for (const r of v.rows) {
        if (r.account !== q.account) continue;
        const tag = tagger.tag(v, r);
        rows.push({ fyId: v.fyId, series: v.series, number: v.number, date: v.date, text: r.text || v.text, amount: r.amount, costCenter: r.costCenter ?? null, project: r.project ?? null, refType: v.refType ?? null, refNumber: v.refNumber ?? null, internalGroup: tag?.group ?? null });
      }
    }
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.series.localeCompare(b.series) || a.number - b.number);
    res.json({ isTestData: ds.isTestData, company: q.company, account: q.account, name: ds.companies[q.company].accounts[q.account]?.name ?? null, mapping: mapper.resolve(q.company, q.account), rows, note: 'Belopp i öre med bokföringens tecken (debet +, kredit −). Underlaget (verifikationen) öppnas i Fortnox med serie och nummer.' });
  })
);

// ── Status, anslutning och hämtning ─────────────────────────────────────────
router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const [conns, years, runs, changes, facts, cfg] = await Promise.all([
      prisma.finConnection.findMany(),
      prisma.finFiscalYear.findMany({ orderBy: { fromDate: 'asc' } }),
      prisma.finImportRun.findMany({ orderBy: { startedAt: 'desc' }, take: 20 }),
      prisma.finChange.findMany({ orderBy: { detectedAt: 'desc' }, take: 100 }),
      loadFacts(),
      loadConfig(),
    ]);
    res.json({
      env: envStatus(),
      scopes: SCOPES,
      companies: COMPANY_IDS.map((id) => {
        const c = conns.find((x) => x.companyId === id);
        return {
          ...COMPANIES[id],
          connected: !!c?.tokenEnc,
          fortnoxName: c?.fortnoxName ?? null,
          connectedAt: c?.connectedAt ?? null,
          lastAttemptAt: c?.lastAttemptAt ?? null,
          lastSuccessAt: c?.lastSuccessAt ?? null,
          lastError: c?.lastError ?? null,
          lockedUntil: c?.lockedUntil ?? null,
          ledgerSyncedAt: c?.ledgerSyncedAt ?? null,
          fiscalYears: years.filter((y) => y.companyId === id).map((y) => ({ fyId: y.fyId, from: y.fromDate, to: y.toDate, importedAt: y.importedAt })),
        };
      }),
      runs,
      changes,
      facts,
      config: cfg,
      categories: CATEGORIES,
      defaultRanges: DEFAULT_RANGES,
    });
  })
);

router.get(
  '/fortnox/auth-url',
  asyncHandler(async (req, res) => {
    res.json({ url: authUrl(companyEnum.parse(req.query.company), uid(req)) });
  })
);

router.get(
  '/fortnox/callback',
  asyncHandler(async (req, res) => {
    const page = (title: string, body: string) => res.send(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;padding:2rem"><h2>${title}</h2><p>${body}</p><script>if(window.opener){window.opener.postMessage({type:'EKONOMI_FORTNOX_DONE'},window.location.origin)}</script></body>`);
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    if (req.query.error) return page('Anslutningen avbröts', esc(String(req.query.error_description ?? req.query.error)));
    try {
      const companyId = verifyState(String(req.query.state ?? ''), uid(req));
      const info = await completeConnection(companyId, String(req.query.code ?? ''), uid(req));
      page('Anslutningen lyckades', `${esc(COMPANIES[companyId].name)} är anslutet till Fortnox-bolaget ${esc(info.companyName)} (${esc(info.orgNumber)}). Du kan stänga fönstret.`);
    } catch (e: any) {
      res.status(400);
      page('Anslutningen misslyckades', esc(String(e?.message ?? e)));
    }
  })
);

router.post(
  '/fortnox/disconnect',
  asyncHandler(async (req, res) => {
    const { company } = parseBody(z.object({ company: companyEnum }), req);
    await disconnect(company);
    res.json({ ok: true });
  })
);

router.post(
  '/sync',
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ company: companyEnum, years: z.union([z.enum(['current', 'previous', 'all']), z.number().int()]).default('current') }), req);
    res.json(await syncCompany(body.company, body.years as YearSelector));
  })
);

// ── Regler och beslut ───────────────────────────────────────────────────────
async function updateConfig(req: Request, fn: (cfg: EkonomiConfig) => void) {
  const cfg = await loadConfig();
  fn(cfg);
  new AccountMapper(cfg.mappingOverrides); // validerar kategorier
  await saveConfig(cfg, uid(req));
  return cfg;
}
const id = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const month = z.string().regex(/^\d{4}-\d{2}$/);

router.put(
  '/mapping',
  asyncHandler(async (req, res) => {
    const b = parseBody(z.object({ companyId: companyEnum.nullable(), account: z.string().min(1), category: z.string().nullable(), note: z.string().optional() }), req);
    if (b.category && !CATEGORY_BY_ID[b.category]) throw BadRequest('Okänd kategori');
    res.json(
      await updateConfig(req, (cfg) => {
        cfg.mappingOverrides = cfg.mappingOverrides.filter((o) => !(o.companyId === b.companyId && o.account === b.account));
        if (b.category) cfg.mappingOverrides.push({ companyId: b.companyId, account: b.account, category: b.category, note: b.note, confirmedBy: uid(req), confirmedAt: new Date().toISOString() });
      })
    );
  })
);

router.post(
  '/mapping/reviewed',
  asyncHandler(async (req, res) => {
    res.json(await updateConfig(req, (cfg) => void (cfg.mappingReviewedAt = new Date().toISOString())));
  })
);

router.post(
  '/internal-rules',
  asyncHandler(async (req, res) => {
    const b = parseBody(
      z.object({
        companyId: companyEnum,
        type: z.enum(['account', 'counterparty', 'voucher']),
        account: z.string().optional(),
        ledger: z.enum(['customer', 'supplier']).optional(),
        counterpartyNumber: z.string().optional(),
        voucher: z.object({ fyId: z.number().int(), series: z.string(), number: z.number().int() }).optional(),
        group: z.string().min(1),
        note: z.string().default(''),
      }),
      req
    );
    if (b.type === 'account' && !b.account) throw BadRequest('Konto krävs');
    if (b.type === 'counterparty' && (!b.ledger || !b.counterpartyNumber)) throw BadRequest('Reskontra och motpartsnummer krävs');
    if (b.type === 'voucher' && !b.voucher) throw BadRequest('Verifikation krävs');
    res.json(await updateConfig(req, (cfg) => void cfg.internalRules.push({ ...b, id: id(), active: true })));
  })
);

router.delete(
  '/internal-rules/:id',
  asyncHandler(async (req, res) => {
    res.json(await updateConfig(req, (cfg) => void (cfg.internalRules = cfg.internalRules.filter((r) => r.id !== req.params.id))));
  })
);

router.post(
  '/adjustments',
  asyncHandler(async (req, res) => {
    const b = parseBody(
      z.object({
        companyId: companyEnum,
        month,
        category: z.string(),
        amount: z.number().int(),
        source: z.string().min(3, 'Källa krävs'),
        method: z.string().min(3, 'Metod krävs'),
        motivation: z.string().min(3, 'Motivering krävs'),
        reverseMonth: month.nullable(),
        handling: z.string().min(3, 'Beskriv hanteringen när bokföringen kommer in'),
      }),
      req
    );
    if (CATEGORY_BY_ID[b.category]?.statement !== 'RR') throw BadRequest('Justeringar kan bara göras på resultatkategorier');
    if (b.reverseMonth && b.reverseMonth <= b.month) throw BadRequest('Vändningsmånaden måste ligga efter justeringsmånaden');
    res.json(await updateConfig(req, (cfg) => void cfg.adjustments.push({ ...b, reverseMonth: b.reverseMonth ?? null, id: id(), active: true, createdBy: uid(req), createdAt: new Date().toISOString() })));
  })
);

router.delete(
  '/adjustments/:id',
  asyncHandler(async (req, res) => {
    // Justeringar raderas inte — de avaktiveras, så att historiken finns kvar.
    res.json(await updateConfig(req, (cfg) => cfg.adjustments.forEach((a) => a.id === req.params.id && (a.active = false))));
  })
);

router.post(
  '/period-status',
  asyncHandler(async (req, res) => {
    const b = parseBody(z.object({ companyId: companyEnum, month, status: z.enum(['preliminar', 'avstamd', 'stangd']), note: z.string().optional() }), req);
    const range = { from: monthStart(b.month), to: monthEnd(b.month) };
    const { ds } = await loadDataset(range);
    const c = ds.companies[b.companyId];
    if (b.status === 'stangd' && !(c.sync.lockedUntil && c.sync.lockedUntil >= range.to)) throw BadRequest('Månaden kan märkas som stängd först när perioden är låst i Fortnox.');
    res.json(
      await updateConfig(req, (cfg) => {
        cfg.periodStatuses = cfg.periodStatuses.filter((p) => !(p.companyId === b.companyId && p.month === b.month));
        if (b.status !== 'preliminar') cfg.periodStatuses.push({ companyId: b.companyId, month: b.month, status: b.status, dataHash: monthHash(c, b.month), markedAt: new Date().toISOString(), markedBy: uid(req), note: b.note });
      })
    );
  })
);

router.post(
  '/initial-verification',
  asyncHandler(async (req, res) => {
    const b = parseBody(z.object({ done: z.boolean(), month: month.optional(), note: z.string().optional() }), req);
    res.json(await updateConfig(req, (cfg) => void (cfg.initialVerification = b.done ? { done: true, month: b.month, note: b.note, by: uid(req), at: new Date().toISOString() } : { done: false })));
  })
);

router.put(
  '/facts/:id',
  asyncHandler(async (req, res) => {
    const b = parseBody(z.object({ status: z.enum(['bekraftat', 'preliminart', 'obesvarat']), answer: z.string() }), req);
    const facts = await loadFacts();
    facts[req.params.id] = { id: req.params.id, ...b, updatedAt: new Date().toISOString(), updatedBy: uid(req) };
    await saveFacts(facts, uid(req));
    res.json(facts);
  })
);

export default router;
