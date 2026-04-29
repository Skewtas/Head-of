import type {
  Invoice,
  InvoiceLine,
  Client,
} from '@prisma/client';

/**
 * Map internal Invoice + Client → Fortnox Invoice payload (V3).
 * Keep this thin: Fortnox-specific field names here, nowhere else.
 */
export function toFortnoxInvoicePayload(
  invoice: Invoice & { lines: InvoiceLine[] },
  client: Client
) {
  if (!client.fortnoxCustomerId) {
    throw new Error(`Client ${client.id} has no fortnoxCustomerId — must sync customer first`);
  }
  return {
    Invoice: {
      CustomerNumber: client.fortnoxCustomerId,
      InvoiceDate: formatDate(new Date()),
      DueDate: formatDate(
        new Date(Date.now() + (client.paymentTermsDays ?? 30) * 24 * 3600_000)
      ),
      Currency: 'SEK',
      Language: 'SV',
      OurReference: 'HeadOf',
      InvoiceRows: invoice.lines.map((line) => ({
        ArticleNumber: line.fortnoxArticleId ?? undefined,
        Description: line.description,
        DeliveredQuantity: line.quantity,
        Unit: unitToFortnox(line.unit),
        Price: line.unitPriceCents / 100,
        VAT: line.vatRate,
        HouseWork: line.rutEligible,
        HouseWorkType: line.rutEligible ? 'CLEANING' : undefined,
        HouseWorkHoursToReport: line.rutEligible && line.unit === 'HOUR' ? line.quantity : undefined,
      })),
      EmailInformation: client.invoiceMethod === 'EMAIL' && client.email
        ? {
            EmailAddressTo: client.email,
            EmailSubject: 'Faktura från Städona',
          }
        : undefined,
      Remarks: 'Genererat av HeadOf',
    },
  };
}

export function toFortnoxCustomerPayload(client: Client) {
  return {
    Customer: {
      Name: client.name,
      OrganisationNumber: client.orgNumber ?? undefined,
      Email: client.email ?? undefined,
      Phone1: client.phone ?? undefined,
      TermsOfPayment: String(client.paymentTermsDays ?? 30),
      Currency: 'SEK',
      Active: client.status === 'ACTIVE',
    },
  };
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function unitToFortnox(unit: string): string {
  switch (unit) {
    case 'HOUR':
      return 'tim';
    case 'PIECE':
      return 'st';
    case 'MONTH':
      return 'mån';
    default:
      return 'st';
  }
}
