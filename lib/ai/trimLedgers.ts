// Deterministic guard against per-lift "load ledgers" in the plan's prose.
//
// The athlete's feedback was that the write-up restated every lift with its
// weight, RPE, and a hold/progress verdict — clutter, since those numbers
// already render on the Plan and Today tabs. Prompt rules and tool-schema
// field descriptions both cut it down but neither eliminated it across test
// builds: the model reliably wants to justify each progression individually.
// So the rule is enforced here instead of hoped for.
//
// The policy mirrors the prompt: a paragraph may keep ONE illustrative load
// example; the rest of the ledger sentences are dropped. Non-ledger prose is
// never touched, so a paragraph that merely mentions a weight in passing
// survives intact.

const LOAD = /\b\d{2,3}(?:\.\d)?\s*lb\b/i;
const VERDICT =
  /\b(hold|holds|holding|held|progress|progresses|progressing|moves? (?:up )?to|move up|re-?establish(?:ed|es)?|stays? at|remains? at|increases? to|drops? to|bumps? to)\b/i;

function splitSentences(paragraph: string): string[] {
  // Split only where sentence-ending punctuation is followed by whitespace and
  // a new sentence's opening character. Splitting on every "." would cut
  // decimals apart ("RPE 6–7.5" → "5 …"), which mangles the surviving prose.
  return paragraph.split(/(?<=[.!?])\s+(?=[A-Z("'—])/);
}

function isLedgerSentence(sentence: string): boolean {
  return LOAD.test(sentence) && VERDICT.test(sentence);
}

/**
 * A paragraph counts as a ledger when it pairs loads with hold/progress
 * verdicts at least three times — the threshold the prompt states. Two
 * mentions is the allowed "illustrative example" case and is left alone.
 */
function trimParagraph(paragraph: string): string {
  const sentences = splitSentences(paragraph);
  const ledgerCount = sentences.filter(isLedgerSentence).length;
  if (ledgerCount < 3) return paragraph;

  let kept = 0;
  const out = sentences.filter((s) => {
    if (!isLedgerSentence(s)) return true;
    kept += 1;
    return kept <= 1; // keep the first as the illustrative example
  });

  const result = out.join(" ").trim();
  // A paragraph that was nothing but ledger collapses to its lead-in (e.g.
  // "Key progressions:") — drop it rather than leave a dangling label.
  if (/^[A-Z][A-Za-z .]{0,40}:$/.test(result)) return "";
  return result;
}

/** Strip per-lift load ledgers from one prose field. */
export function trimLoadLedgers(text: string): string {
  if (!text) return text;
  return text
    .split(/\n\s*\n/)
    .map(trimParagraph)
    .filter((p) => p.trim().length > 0)
    .join("\n\n");
}
