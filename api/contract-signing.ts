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
      acceptedTerms?: boolean;
    };

    if (!body.acceptedTerms) {
      return res.status(400).json({ error: 'Du måste kryssa i att du godkänner avtalet.' });
    }
    if (!body.personalNumber || !body.phone) {
      return res.status(400).json({ error: 'Fyll i personnummer och telefonnummer.' });
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
    const allSigners = await prisma.signer.findMany({ where: { contractId: contract.id } });
    const allSigned = allSigners.every((s) => s.status === 'SIGNED');
    const anySigned = allSigners.some((s) => s.status === 'SIGNED');

    if (allSigned) {
      await prisma.contract.update({
        where: { id: contract.id },
        data: { status: 'SIGNED' },
      });
      // Lås versionen så den inte kan redigeras
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
