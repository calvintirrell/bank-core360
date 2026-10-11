/** Short, bank-language definitions for terms underlined in the copy. */
export const GLOSSARY: Record<string, { term: string; definition: string }> = {
  core: {
    term: 'core banking system',
    definition: 'The main software a bank runs on: it holds the customer list, the accounts and every transaction. Two banks almost always run two different ones.',
  },
  'entity-resolution': {
    term: 'matching',
    definition: 'Working out which records in two systems describe the same real person, using name, date of birth, SSN digits, phone and address, with a confidence score.',
  },
  'review-queue': {
    term: 'review queue',
    definition: 'Possible duplicate customers the matching was not sure enough about to merge on its own. A person confirms or rejects each pair.',
  },
  dormant: {
    term: 'quiet account',
    definition: 'An open account with no transactions for 180 days before the as-of date. The bank\'s own rule can set a different window.',
  },
  lineage: {
    term: 'where a number came from',
    definition: 'For every column, which bank\'s system supplied it, which field, and what was done to it on the way. It is what lets a figure be defended in an audit.',
  },
  'as-of': {
    term: 'as-of date',
    definition: 'The single date every "recent", "quiet" or "since" on this page is measured from, so numbers do not shift while you read them.',
  },
}
export type GlossaryKey = keyof typeof GLOSSARY
