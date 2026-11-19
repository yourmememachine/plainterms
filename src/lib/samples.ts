/** Built-in sample documents so anyone can try PlainTerms in one click. */

export interface SampleDoc {
  id: string;
  title: string;
  text: string;
}

export const SAMPLES: SampleDoc[] = [
  {
    id: "lease",
    title: "Apartment lease excerpt",
    text: `RESIDENTIAL TENANCY AGREEMENT (EXCERPT)

1. TERM. The tenancy begins on September 1, 2026 and continues on a month-to-month basis after August 31, 2027 unless either party gives written notice of at least 60 days.

2. RENT. The Tenant shall pay rent of $2,150.00 on the first day of each month. A late charge of $75.00 applies if rent is received after the 5th day of the month, together with interest at 12% per annum on any balance outstanding for more than 30 days.

3. SECURITY DEPOSIT. The Tenant has paid a security deposit of $1,075.00. The deposit is non-refundable if the Tenant terminates this agreement within the first six months.

4. RENEWAL. This agreement shall automatically renew for successive one-year terms unless the Tenant provides written notice at least 90 days before the end of the then-current term.

5. LANDLORD'S CHANGES. The Landlord may change the rules and regulations of the building at any time in its sole discretion, and such changes form part of this agreement.

6. EARLY TERMINATION. If the Tenant terminates early, the Tenant shall pay an early termination fee equal to two months' rent as liquidated damages.

7. DISPUTES. Any dispute arising under this agreement shall be resolved by binding arbitration in the Province of Ontario, and the Tenant waives any right to a jury trial.`,
  },
  {
    id: "insurance",
    title: "Insurance claim denial letter",
    text: `Dear Policyholder,

We have completed our review of your claim dated October 3, 2026 for water damage at the insured premises.

Your policy provides coverage for sudden and accidental discharge of water. Our adjuster determined that the damage resulted from a gradual leak over a period exceeding 14 days, which is excluded under Section 8.3 of your policy. Accordingly, your claim is denied.

You may request a re-examination of this decision by writing to us within 30 days of the date of this letter, quoting reference number CL-2026-88412. If we do not hear from you within that period, your file will be closed and the denial will be final.

Please note that any legal action against us arising from this claim must be commenced within one year of the date of denial, after which the claim shall be deemed abandoned and you shall not be liable to recover any amount.

Sincerely,
Claims Department`,
  },
  {
    id: "gym",
    title: "Gym membership terms",
    text: `MEMBERSHIP TERMS

Your membership fee is $59.99 per month, billed on the 15th of each month to the payment method on file. Memberships automatically renew month to month.

You may cancel at any time with 30 days written notice; however, an early cancellation fee of $199.00 applies to all cancellations within the first 12 months. Fees already paid are non-refundable.

We may modify these terms, including prices, at any time without notice. Continued use of the facilities after a change constitutes acceptance of the new terms.

You agree to indemnify and hold harmless the club, its owners and staff from any claims arising from your use of the equipment. The club shall not be liable for any injury, loss or damage except where caused by gross negligence.

Failed payments are subject to a late fee of $25.00 per occurrence plus interest at 18% per annum.`,
  },
];
