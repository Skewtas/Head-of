/**
 * Public endpoint för anställd att signera avtal via HMAC-länk.
 * Ingen Clerk-auth — token i URL är åtkomsten.
 *
 *   GET  /api/contract-signing?token=X               → returnerar avtalsinnehåll + person-info att verifiera mot
 *   POST /api/contract-signing?token=X               → tar emot signatur (personnummer + telefon + checkbox)
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from './_lib/prisma.js';
import { verifySigningToken, contentHash } from './_lib/signingToken.js';

export const config = { maxDuration: 30 };

/** Bevis-vänlig maskering: visa bara sista 4 tecknen i loggen. */
function hashLast4(s: string): string {
  if (!s) return '';
  const last4 = s.slice(-4);
  return `••••${last4}`;
}

function normalizePnr(s: string): string {
  const digits = s.replace(/[^0-9]/g, '');
  if (digits.length === 10) {
    const yy = parseInt(digits.slice(0, 2), 10);
    const century = yy > 30 ? '19' : '20';
    return century + digits;
  }
  return digits;
}
function normalizePhone(s: string): string {
  return s.replace(/[\s\-()]/g, '').replace(/^\+?46/, '0');
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = String(req.query.token || '');
  if (!token) return res.status(400).json({ error: 'Token saknas.' });
  const verified = verifySigningToken(token);
  if (!verified) return res.status(401).json({ error: 'Ogiltig eller utgången signeringslänk.' });

  const contract = await prisma.contract.findUnique({
    where: { id: verified.contractId },
    include: {
      person: true,
      ownCompany: true,
      versions: { orderBy: { version: 'desc' }, take: 1 },
      signers: { orderBy: { signingOrder: 'asc' } },
    },
  });
  if (!contract) return res.status(404).json({ error: 'Avtalet hittades inte.' });
  const signer = contract.signers.find((s) => s.id === verified.signerId);
  if (!signer) return res.status(404).json({ error: 'Signerare hittades inte.' });
  const version = contract.versions[0];
  if (!version) return res.status(500).json({ error: 'Ingen avtalsversion finns.' });

  // ── GET: visa avtalet ────────────────────────────────────────────────
  if (req.method === 'GET') {
    return res.json({
      contract: {
        id: contract.id,
        title: contract.title,
        category: contract.category,
        status: contract.status,
        startDate: contract.startDate,
        endDate: contract.endDate,
      },
      company: {
        name: contract.ownCompany.name,
        organizationNumber: contract.ownCompany.organizationNumber,
        signatoryName: contract.ownCompany.signatoryName,
      },
      person: contract.person
        ? { firstName: contract.person.firstName, lastName: contract.person.lastName }
        : null,
      signer: {
        id: signer.id,
        name: signer.name,
        email: signer.email,
        status: signer.status,
        signedAt: signer.signedAt,
        signingOrder: signer.signingOrder,
      },
      content: version.content,
      versionNumber: version.version,
      expiresAt: verified.expiresAt,
    });
  }

  // ── POST: ta emot signatur ───────────────────────────────────────────
  if (req.method === 'POST') {
    if (signer.status === 'SIGNED') {
      return res.status(400).json({ error: 'Avtalet är redan signerat av dig.' });
    }

    const body = (req.body || {}) as {
      personalNumber?: string;
      phone?: string;
      fullName?: string;
      acceptedTerms?: boolean;
    };

    if (!body.acceptedTerms) {
      return res.status(400).json({ error: 'Du måste kryssa i att du godkänner avtalet.' });
    }
    if (!body.fullName || !body.personalNumber || !body.phone) {
      return res.status(400).json({ error: 'Fyll i namn, personnummer och mobilnummer.' });
    }

    // Verifiera mot ContractPerson: BÅDE personnummer OCH telefon måste matcha.
    // Generisk felmeddelande — visa inte vilken uppgift som är fel (säkerhet).
    const person = contract.person;
    const GENERIC_MISMATCH = 'Uppgifterna stämmer inte överens med mottagaren av avtalet. Kontrollera personnummer och telefonnummer.';

    if (!person?.personalNumber || !person?.phone) {
      return res.status(400).json({
        error: 'Avtalets mottagare har inte personnummer och/eller telefon registrerat. Kontakta arbetsgivaren.',
      });
    }
    const providedPnr = normalizePnr(body.personalNumber);
    const expectedPnr = normalizePnr(person.personalNumber);
    const providedPhone = normalizePhone(body.phone);
    const expectedPhone = normalizePhone(person.phone);
    if (providedPnr !== expectedPnr || providedPhone !== expectedPhone) {
      return res.status(400).json({ error: GENERIC_MISMATCH });
    }

    const ip = String(
      req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown'
    ).split(',')[0].trim();
    const userAgent = String(req.headers['user-agent'] || 'unknown');
    const signedAt = new Date();
    const hash = contentHash(version.content);

    const auditData = {
      signedAt: signedAt.toISOString(),
      ip,
      userAgent,
      contentHash: hash,
      contentVersion: version.version,
      providedFullName: body.fullName.trim(),
      // Hashade istället för klartext i loggen (säkerhet).
      providedPersonalNumberHash: hashLast4(normalizePnr(body.personalNumber)),
      providedPhoneHash: hashLast4(normalizePhone(body.phone)),
      timewaveEmployeeId: person?.timewaveEmployeeId ?? null,
      signingOrder: signer.signingOrder,
    };

    // Uppdatera signer
    await prisma.signer.update({
      where: { id: signer.id },
      data: {
        status: 'SIGNED',
        signedAt,
        auditData: auditData as any,
      },
    });

    // Räkna om alla signers är klara → uppdatera contract-status
    const allSigners = await prisma.signer.findMany({
      where: { contractId: contract.id },
      orderBy: { signingOrder: 'asc' },
    });
    const allSigned = allSigners.every((s) => s.status === 'SIGNED');
    const anySigned = allSigners.some((s) => s.status === 'SIGNED');

    if (allSigned) {
      await prisma.contract.update({
        where: { id: contract.id },
        data: { status: 'SIGNED' },
      });
      await prisma.contractVersion.update({
        where: { id: version.id },
        data: { locked: true },
      });
    } else if (anySigned) {
      await prisma.contract.update({
        where: { id: contract.id },
        data: { status: 'PARTIALLY_SIGNED' },
      });
    }

    // Om det var ANSTÄLLD (order 1) som just signerade → skicka länk till
    // ARBETSGIVAREN (order 2) så hon kan signera via samma flöde.
    if (signer.signingOrder === 1 && !allSigned) {
      const employerSigner = allSigners.find((s) => s.signingOrder === 2);
      if (employerSigner && employerSigner.status !== 'SIGNED') {
        try {
          const { issueSigningToken } = await import('./_lib/signingToken.js');
          const { deliverNewsletter } = await import('./_lib/newsletterSender.js');
          const token = issueSigningToken(contract.id, employerSigner.id);
          const appUrl = process.env.APP_URL || `https://${req.headers.host}`;
          const signUrl = `${appUrl}/sign?token=${encodeURIComponent(token)}`;
          const empName = signer.name;
          const html = `
            <div style="font-family:Inter,Arial,sans-serif;color:#1a1a2e;line-height:1.6;max-width:560px;margin:0 auto;padding:24px;">
              <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:24px;margin:0 0 16px;">
                ${escapeHtml(empName)} har signerat sitt anställningsavtal
              </h1>
              <p style="margin:0 0 16px;">
                <strong>${escapeHtml(empName)}</strong> signerade avtalet ${signedAt.toLocaleString('sv-SE')}.
                Nu behöver du signera som arbetsgivare för att slutföra avtalet.
              </p>
              <div style="text-align:center;margin:24px 0;">
                <a href="${signUrl}" style="display:inline-block;padding:14px 28px;background:#1a1a2e;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Öppna &amp; signera som arbetsgivare</a>
              </div>
              <p style="margin:0 0 16px;font-size:13px;color:#4b4a55;">
                Du behöver ange ditt namn, personnummer och telefonnummer för att bekräfta
                signaturen. När båda parter signerat låses avtalet automatiskt.
              </p>
              <p style="margin:0;color:#8b8578;font-size:12px;">Länken är personlig och giltig i 30 dagar.</p>
            </div>
          `;
          await deliverNewsletter({
            newsletterId: `employer-sign-${contract.id}-${employerSigner.id}`,
            recipients: [employerSigner.email],
            subject: `${empName} har signerat — din tur att signera`,
            htmlContent: html,
            appUrl,
          });
        } catch (e) {
          console.error('[contract-signing] employer mail failed', e);
        }
      }
    }

    // Om ALLA har signerat → skicka bekräftelse till både anställd + arbetsgivare
    if (allSigned) {
      try {
        const { deliverNewsletter } = await import('./_lib/newsletterSender.js');
        const appUrl = process.env.APP_URL || `https://${req.headers.host}`;
        const html = `
          <div style="font-family:Inter,Arial,sans-serif;color:#1a1a2e;line-height:1.6;max-width:560px;margin:0 auto;padding:24px;">
            <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:24px;margin:0 0 16px;">
              ✓ Anställningsavtalet är fullständigt signerat
            </h1>
            <p style="margin:0 0 16px;">
              Både anställd och arbetsgivare har nu signerat avtalet
              <strong>${escapeHtml(contract.title)}</strong>. Avtalet är låst och sparat.
            </p>
            <p style="margin:0;color:#8b8578;font-size:12px;">/HeadOf</p>
          </div>
        `;
        const emails = Array.from(new Set(allSigners.map((s) => s.email).filter(Boolean) as string[]));
        await deliverNewsletter({
          newsletterId: `all-signed-${contract.id}`,
          recipients: emails,
          subject: `✓ Anställningsavtal signerat — ${contract.title}`,
          htmlContent: html,
          appUrl,
        });
      } catch (e) {
        console.error('[contract-signing] confirmation mail failed', e);
      }
    }

    // Audit log
    await prisma.auditLog.create({
      data: {
        actorClerkId: null,
        action: 'contract_signed',
        entityType: 'Contract',
        entityId: String(contract.id),
        after: { signerId: signer.id, signerName: signer.name, ...auditData } as any,
      },
    }).catch(() => {});

    return res.json({
      ok: true,
      signedAt,
      contractStatus: allSigned ? 'SIGNED' : 'PARTIALLY_SIGNED',
      allSigned,
    });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
