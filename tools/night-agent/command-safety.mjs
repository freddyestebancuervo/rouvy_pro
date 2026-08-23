// Korixa Night Agent — Command Safety Classification (NIGHT_HARDENING_2,
// 2026-08-23).
//
// A sixth-category, fail-closed classifier for a PROPOSED operation
// (typically a shell/CLI command a Night Agent is about to run), answering
// "what blast radius does this have, and is it currently authorized?" This
// is deliberately a NEW, separate concern from claim-taxonomy.mjs (which
// classifies EVIDENCE about something that already happened) and
// red-team-gate.mjs (which classifies a COMMAND'S FAILURE after the fact).
// This module classifies a command's RISK before it runs.
//
// Six closed classes, in ascending rough risk order:
//   READ_ONLY               - cannot mutate anything, anywhere.
//   LOCAL_MUTATION           - mutates only this machine's local working
//                              tree/filesystem (git add/commit, file edits).
//   REMOTE_NONPROD_MUTATION  - mutates a remote system, but not Production
//                              (pushing your own feature branch, opening a
//                              Draft PR, deploying to a nonprod environment).
//   PRODUCTION_MUTATION      - mutates Production in any way.
//   DESTRUCTIVE              - irreversible regardless of target (force-push,
//                              rm -rf, DROP TABLE/DATABASE, hard reset,
//                              secret rotation, resource deletion) -- this
//                              classification is cross-cutting: a DESTRUCTIVE
//                              command targeting Development is still
//                              DESTRUCTIVE, not merely REMOTE_NONPROD_MUTATION.
//   UNKNOWN                  - matched no recognized safe or mutation
//                              pattern, OR matched a mutation pattern with no
//                              explicitly declared target environment. Fails
//                              closed: UNKNOWN NEVER becomes authorized, no
//                              matter what a caller claims.
//
// FASE 7's "deploy and verify" example is exactly the UNKNOWN case this
// module exists to catch: a mutation-shaped instruction/command with no
// explicit, structured target environment must never be silently assumed to
// mean Development, Staging, or (worst of all) Production -- it must fail
// closed to UNKNOWN and require a human/explicit decision.
//
// This module does NOT attempt to be a complete command-intent parser (that
// is an unbounded problem no regex/heuristic set can honestly claim to
// solve). It is deliberately narrow: a FIXED allowlist for READ_ONLY, a
// FIXED pattern list for DESTRUCTIVE (these apply regardless of target), and
// a target-AWARE classification for everything else that merely LOOKS like a
// mutation. Anything that matches nothing recognized is UNKNOWN, never
// guessed to be safe.

export const COMMAND_SAFETY_CLASSES = Object.freeze([
  'READ_ONLY',
  'LOCAL_MUTATION',
  'REMOTE_NONPROD_MUTATION',
  'PRODUCTION_MUTATION',
  'DESTRUCTIVE',
  'UNKNOWN',
]);

export const TARGET_ENVIRONMENTS = Object.freeze(['Local', 'Development', 'Staging', 'Production']);

// ---------------------------------------------------------------------------
// READ_ONLY allowlist — Section 10's explicit "permitido sin autorización
// adicional" list, plus the equivalent gcloud/node primitives this project's
// own KORIXA_* audits already treat as always-safe. A command must match one
// of these EXACTLY at the start (after trimming) to ever classify as
// READ_ONLY; there is no heuristic path into this class.
// ---------------------------------------------------------------------------

const READ_ONLY_PREFIXES = Object.freeze([
  'git status', 'git diff', 'git log', 'git show', 'git fetch',
  'git rev-parse', 'git ls-remote', 'git branch --show-current', 'git worktree list',
  'git merge-base --is-ancestor',
  'gh pr view', 'gh pr checks', 'gh pr list', 'gh pr diff',
  'gh run view', 'gh run list',
  'gh api repos', // GET-only -- gated separately by GH_API_MUTATING_METHOD_PATTERN below, never treated as safe on prefix match alone.
  'gcloud config get-value',
  'node --version', 'node --check', 'node --test',
  'pwd',
]);

// `gcloud`/`gh api` read verbs recognized as READ_ONLY when they are the
// verb actually present in the command text -- narrower than the full
// prefix list above, used only for the gcloud-resource-verb check below.
const READ_ONLY_RESOURCE_VERB_PATTERN = /\b(describe|list|get-iam-policy|get|view)\b/;

// NIGHT_HARDENING_2-R4 SECURITY CORRECTION (this revision) closes
// COMMAND-SAFETY-CHAIN-001 (CRITICAL), reproduced live by an independent
// audit: `matchesReadOnlyAllowlist`/`LOCAL_ONLY_MUTATION_PREFIXES`/
// `isOwnBranchGitHubOperation` only ever verified that a command STARTED
// WITH a known-safe invocation, never that it consisted of ONLY that
// invocation. `git status && rm -rf /`, `gh pr edit 73 && gcloud run deploy
// svc --project=prod`, and `gh pr create --draft --title x && gcloud iam
// service-accounts keys create k.json` all classified READ_ONLY or
// standing-authorized REMOTE_NONPROD_MUTATION, with `authorized: true` and
// zero explicit grant, because DESTRUCTIVE_PATTERNS/target-environment logic
// was never reached once a prefix matched. Fixed by refusing EVERY prefix-
// allowlist / standing-authorization shortcut outright whenever the command
// contains any shell chaining/substitution metacharacter -- a chained
// command can only ever resolve via DESTRUCTIVE_PATTERNS (still a
// whole-string scan, unaffected) or the general mutation-verb + declared-
// target-environment path, both of which require either a recognized
// destructive pattern or an explicit target/authorization to reach anything
// but UNKNOWN. This is a deliberately blunt, conservative rule (a real
// argument value containing a literal `|` character would also trip it,
// pushing a legitimate command to UNKNOWN rather than READ_ONLY) -- fail-
// safe over-restriction is the accepted cost, consistent with this
// module's own stated non-goal of being a complete shell parser.
const SHELL_CHAINING_PATTERN = /(&&|\|\||;|\||`|\$\()/;

function containsShellChaining(command) {
  return SHELL_CHAINING_PATTERN.test(command);
}

// Same audit finding, second half: the fixed `gh api` prefix accepted any
// HTTP method, including mutating ones a caller could pass via `-X`/
// `--method`. `gh api repos/x/y -X DELETE` (or PUT/POST/PATCH) classified
// READ_ONLY with zero authorization. Fixed by refusing the READ_ONLY match
// outright whenever a mutating method is present -- GET (the default when
// no method flag appears at all) remains the only path to READ_ONLY here.
const GH_API_MUTATING_METHOD_PATTERN = /(-X|--method)\s+(POST|PUT|PATCH|DELETE)\b/i;

function matchesReadOnlyAllowlist(command) {
  if (containsShellChaining(command)) return false;
  // A prefix matches when followed by a word boundary (space, slash, or
  // end-of-string) -- not merely by `startsWith`, which would also match an
  // unrelated command that happens to share a text prefix (e.g. "git status"
  // must not match "git statusline"), but must still match "gh api repos/..."
  // where the prefix is immediately followed by "/", not a space.
  for (const p of READ_ONLY_PREFIXES) {
    if (!new RegExp(`^${escapeRegExp(p)}(\\s|/|$)`).test(command)) continue;
    if (p === 'gh api repos' && GH_API_MUTATING_METHOD_PATTERN.test(command)) return false;
    return true;
  }
  // A `gcloud <service> <resource>` invocation is READ_ONLY only when its
  // verb is one of the recognized read verbs AND it contains no recognized
  // mutation verb at all (a command can't be trusted read-only just because
  // it happens to also contain the word "describe" somewhere).
  if (/^gcloud\s/.test(command) && READ_ONLY_RESOURCE_VERB_PATTERN.test(command) && !KNOWN_MUTATION_VERB_PATTERN.test(command)) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// DESTRUCTIVE — fixed pattern list. Cross-cutting: always DESTRUCTIVE
// regardless of declared target, always requires EXPLICIT authorization,
// never satisfiable by "standing" authorization (see evaluateCommandSafety).
// ---------------------------------------------------------------------------

const DESTRUCTIVE_PATTERNS = Object.freeze([
  /\brm\s+-rf\b/i,
  /--force\b/i,
  /\bforce-push\b/i,
  /\bpush\s+--force\b/i,
  /\bdrop\s+(table|database|index)\b/i,
  /\bdelete\s+from\b/i,
  /\btruncate\s+table\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-z]*f/i,
  /\bgit\s+branch\s+-D\b/,
  /\bsecrets?\s+versions?\s+destroy\b/i,
  /\biam\s+.*remove-iam-policy-binding\b/i,
  /\bsql\s+instances\s+delete\b/i,
  /\brun\s+(services|jobs)\s+delete\b/i,
  /\bcompute\s+instances\s+delete\b/i,
  /\bfirestore\s+databases\s+delete\b/i,
  /\bsecrets?\s+delete\b/i,
]);

// ---------------------------------------------------------------------------
// Mutation-verb pattern — used ONLY to decide "does this look like a
// mutation at all", never by itself to decide WHICH mutation class. The
// actual class (LOCAL / REMOTE_NONPROD / PRODUCTION / UNKNOWN) always also
// depends on an explicitly declared target environment.
// ---------------------------------------------------------------------------

const KNOWN_MUTATION_VERB_PATTERN = /\b(deploy|create|update|apply|set-iam-policy|add-iam-policy-binding|migrate|rotate|push|commit|add|write|edit)\b/i;

// git add/commit and ordinary file writes are LOCAL by construction -- they
// never touch a remote system regardless of declared environment. Checked
// before the target-environment branch so a caller doesn't have to declare
// an environment at all for purely local git plumbing.
const LOCAL_ONLY_MUTATION_PREFIXES = Object.freeze(['git add', 'git commit']);

function normalizeTargetEnvironment(rawValue) {
  return TARGET_ENVIRONMENTS.includes(rawValue) ? rawValue : null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const STANDING_AUTHORIZED_GH_PREFIXES = Object.freeze(['gh pr create --draft', 'gh pr edit']);

// Shared by classifyCommandSafety (to route these commands away from the
// target-environment-required branch) and isStandingAuthorized (to actually
// grant standing authorization) -- kept as one definition so the two never
// silently drift apart. Refuses outright on any chained command (see
// NIGHT_HARDENING_2-R4 above) -- standing authorization NEVER applies to a
// command that isn't provably just the one recognized invocation.
function isOwnBranchGitHubOperation(command, currentBranchName) {
  if (containsShellChaining(command)) return false;
  if (STANDING_AUTHORIZED_GH_PREFIXES.some((p) => command.startsWith(p))) return true;
  if (!currentBranchName || currentBranchName === 'main' || currentBranchName === 'master') return false;
  const ownBranchPushPattern = new RegExp(`^git push(\\s+-u)?\\s+origin\\s+${escapeRegExp(currentBranchName)}(\\s|$)`);
  return ownBranchPushPattern.test(command);
}

/**
 * @param {object} input
 * @param {string} input.command
 * @param {string} [input.targetEnvironment] - one of TARGET_ENVIRONMENTS. Required for this function to ever classify a mutation-shaped command as anything other than UNKNOWN.
 */
export function classifyCommandSafety(input) {
  const command = typeof input?.command === 'string' ? input.command.trim() : '';
  if (!command) {
    return Object.freeze({ commandSafetyClass: 'UNKNOWN', reason: 'empty_or_non_string_command' });
  }

  // NIGHT_HARDENING_2-R4: DESTRUCTIVE is checked FIRST, before READ_ONLY and
  // before target-environment logic, and is unconditional -- a destructive
  // command aimed at Development is still DESTRUCTIVE, never downgraded to
  // REMOTE_NONPROD_MUTATION merely because the target isn't Production, and
  // (the actual point of moving this check first) never masked by a
  // READ_ONLY-looking prefix earlier in the command string. This is a
  // whole-string scan, so it still catches a destructive pattern anywhere in
  // a chained command regardless of what precedes it.
  if (DESTRUCTIVE_PATTERNS.some((p) => p.test(command))) {
    return Object.freeze({ commandSafetyClass: 'DESTRUCTIVE', reason: 'matched_destructive_pattern' });
  }

  // NIGHT_HARDENING_2-R4: every remaining "safe shortcut" path
  // (READ_ONLY allowlist, LOCAL_ONLY_MUTATION_PREFIXES, own-branch/gh-pr
  // standing authorization) is refused outright for any command containing
  // shell chaining/substitution syntax -- none of these prefix-based checks
  // can ever prove the command consists of ONLY the matched invocation once
  // a second command could be appended. A chained command can only resolve
  // via the DESTRUCTIVE scan above (already run) or the general mutation-
  // verb + declared-target-environment path below, which requires an
  // explicit authorization for anything beyond UNKNOWN.
  const chained = containsShellChaining(command);

  if (!chained && matchesReadOnlyAllowlist(command)) {
    return Object.freeze({ commandSafetyClass: 'READ_ONLY', reason: 'matched_read_only_allowlist' });
  }

  if (!chained && LOCAL_ONLY_MUTATION_PREFIXES.some((p) => command === p || command.startsWith(`${p} `))) {
    return Object.freeze({ commandSafetyClass: 'LOCAL_MUTATION', reason: 'matched_local_only_mutation_prefix' });
  }

  // git push to the CALLER'S OWN current feature branch, and opening/
  // updating a Draft PR, are GitHub-hosting operations, not cloud/infra
  // operations -- they have no "target environment" in the
  // Local/Development/Staging/Production sense at all, so they must be
  // classifiable WITHOUT requiring `targetEnvironment` to be declared.
  // Checked before the target-environment-required branch below;
  // `isStandingAuthorized` still separately confirms the branch really is
  // the caller's own current branch (never main/master) before treating
  // this as pre-authorized routine work. (isOwnBranchGitHubOperation
  // already refuses chained commands internally -- no `!chained` guard
  // needed here specifically, kept for defense-in-depth/readability.)
  if (!chained && isOwnBranchGitHubOperation(command, input?.currentBranchName)) {
    return Object.freeze({ commandSafetyClass: 'REMOTE_NONPROD_MUTATION', reason: 'matched_own_branch_github_operation' });
  }

  if (!KNOWN_MUTATION_VERB_PATTERN.test(command)) {
    // Matches nothing recognized as safe, destructive, or mutation-shaped at
    // all -- fail closed rather than guessing this is harmless.
    return Object.freeze({ commandSafetyClass: 'UNKNOWN', reason: 'no_recognized_pattern' });
  }

  const targetEnvironment = normalizeTargetEnvironment(input?.targetEnvironment);
  if (targetEnvironment === 'Production') {
    return Object.freeze({ commandSafetyClass: 'PRODUCTION_MUTATION', reason: 'mutation_verb_with_declared_production_target' });
  }
  if (targetEnvironment === 'Development' || targetEnvironment === 'Staging') {
    return Object.freeze({ commandSafetyClass: 'REMOTE_NONPROD_MUTATION', reason: 'mutation_verb_with_declared_nonprod_target' });
  }
  if (targetEnvironment === 'Local') {
    return Object.freeze({ commandSafetyClass: 'LOCAL_MUTATION', reason: 'mutation_verb_with_declared_local_target' });
  }

  // FASE 7's "deploy and verify" case: a mutation-shaped command with NO
  // explicit, structured target environment. Never assumed to be
  // local/nonprod just because Production wasn't named -- fails closed.
  return Object.freeze({ commandSafetyClass: 'UNKNOWN', reason: 'mutation_verb_without_declared_target_environment' });
}

// ---------------------------------------------------------------------------
// Standing (pre-)authorization — the NARROW set of REMOTE_NONPROD_MUTATION
// operations Section 10 itself already authorizes as routine, controlled
// work (pushing to the CALLER'S OWN current feature branch; opening/updating
// a Draft PR) -- never main, never any other branch, never anything
// PRODUCTION_MUTATION/DESTRUCTIVE/UNKNOWN, which can NEVER be standing-
// authorized under any circumstance.
// ---------------------------------------------------------------------------

export function isStandingAuthorized(input) {
  const commandSafetyClass = input?.commandSafetyClass;
  const command = typeof input?.command === 'string' ? input.command.trim() : '';
  const currentBranchName = typeof input?.currentBranchName === 'string' && input.currentBranchName.length > 0 ? input.currentBranchName : null;

  // Defense-in-depth: `evaluateCommandSafety` always derives
  // `commandSafetyClass` from the real `classifyCommandSafety(input)` (which
  // already refuses to label a chained command LOCAL_MUTATION), so this
  // branch is unreachable via that intended entry point. Guarded again here
  // in case this exported function is ever called directly with a
  // caller-asserted `commandSafetyClass` that doesn't actually match
  // `command` -- a chained command must never be treated as standing-
  // authorized no matter what class a caller claims for it.
  if (containsShellChaining(command)) return false;

  if (commandSafetyClass === 'LOCAL_MUTATION') return true;

  if (commandSafetyClass !== 'REMOTE_NONPROD_MUTATION') {
    // PRODUCTION_MUTATION, DESTRUCTIVE, and UNKNOWN can never be standing-
    // authorized -- always require a fresh, explicit decision.
    return false;
  }

  return isOwnBranchGitHubOperation(command, currentBranchName);
}

// ---------------------------------------------------------------------------
// evaluateCommandSafety — single entry point combining classification +
// authorization. UNKNOWN is structurally unauthorizable: no combination of
// inputs, including `explicitAuthorizationGranted: true`, can make an
// UNKNOWN command's `authorized` field true. If the command couldn't be
// classified, there is nothing meaningful being "authorized" -- a caller
// claiming authorization for an unrecognized operation is exactly the
// ambiguity FASE 7 requires this module to refuse.
// ---------------------------------------------------------------------------

/**
 * @param {object} input
 * @param {string} input.command
 * @param {string} [input.targetEnvironment]
 * @param {string} [input.currentBranchName]
 * @param {boolean} [input.explicitAuthorizationGranted]
 */
export function evaluateCommandSafety(input) {
  const classification = classifyCommandSafety(input);
  const standingAuthorized = isStandingAuthorized({
    commandSafetyClass: classification.commandSafetyClass,
    command: input?.command,
    currentBranchName: input?.currentBranchName,
  });
  const explicitAuthorizationGranted = input?.explicitAuthorizationGranted === true;

  let authorized;
  if (classification.commandSafetyClass === 'READ_ONLY') {
    authorized = true;
  } else if (classification.commandSafetyClass === 'UNKNOWN') {
    authorized = false; // never overridable, by design.
  } else if (classification.commandSafetyClass === 'DESTRUCTIVE' || classification.commandSafetyClass === 'PRODUCTION_MUTATION') {
    authorized = explicitAuthorizationGranted; // standing authorization never applies to either.
  } else {
    authorized = standingAuthorized || explicitAuthorizationGranted;
  }

  return Object.freeze({
    commandSafetyClass: classification.commandSafetyClass,
    classificationReason: classification.reason,
    standingAuthorized,
    explicitAuthorizationGranted,
    authorized,
  });
}
