export interface EvidenceResult {
  triggered: boolean;
  claims: string[];
  message: string;
}

const CLAIM_PATTERNS = [
  /all tests pass/i,
  /no issues found/i,
  /works correctly/i,
  /verified successfully/i,
  /no errors/i,
  /no bugs/i,
  /fully functional/i,
  /everything works/i,
  /all checks pass/i,
];

const EVIDENCE_PATTERNS = [
  /```[\s\S]*?```/,                   // code blocks
  /\$\s+\S+/,                         // shell commands ($ command)
  /[a-zA-Z_/][a-zA-Z0-9_/.-]*\.[a-zA-Z]{1,5}/,  // file paths
  /✓|✗|PASS|FAIL|passed|failed/,      // test result indicators
  /\d+\s+(tests?|specs?|assertions?)\s+(passed|failed)/i, // test counts
  /Error:|Warning:|Exception:/i,       // error outputs
];

export function evidenceGuard(output: string): EvidenceResult {
  const matchedClaims: string[] = [];

  for (const pattern of CLAIM_PATTERNS) {
    const match = output.match(pattern);
    if (match) {
      matchedClaims.push(match[0].toLowerCase());
    }
  }

  if (matchedClaims.length === 0) {
    return { triggered: false, claims: [], message: '' };
  }

  const hasEvidence = EVIDENCE_PATTERNS.some(pattern => pattern.test(output));

  if (hasEvidence) {
    return { triggered: false, claims: matchedClaims, message: '' };
  }

  return {
    triggered: true,
    claims: matchedClaims,
    message: `Claims without evidence: ${matchedClaims.join(', ')}. Output should include supporting evidence (test output, file paths, command results).`,
  };
}
