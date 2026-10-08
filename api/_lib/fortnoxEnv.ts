/** Kastas när Fortnox OAuth-uppgifterna saknas — ett konfigurationsfel som inte ska döljas. */
export class FortnoxConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FortnoxConfigError';
  }
}

// Fortnox OAuth-uppgifter läses från miljövariabler (aldrig hårdkodade)
export const requireFortnoxEnv = (name: 'FORTNOX_CLIENT_ID' | 'FORTNOX_CLIENT_SECRET'): string => {
  const value = process.env[name];
  if (!value) {
    throw new FortnoxConfigError(`Miljövariabeln ${name} saknas. Lägg till den i .env lokalt och i Vercel.`);
  }
  return value;
};
