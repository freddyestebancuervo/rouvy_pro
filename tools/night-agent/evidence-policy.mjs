// Korixa Night Agent — Double Evidence Policy for P0/P1 (Improvement 2/5).
//
// Structurally prevents a class of audit error distinct from, but related
// to, the one Improvement 1 closed: even once the OFFICIAL state of a file
// is correctly resolved (Improvement 1), a Night Agent could still elevate
// a finding to P0/P1 severity from a single, weak, duplicated, or
// contradicted observation. The incident that motivates this module: a
// stale local PROJECT_STATUS.md was elevated to P0 on its own, even though
// the official `main` version directly contradicted it.
//
// R2 SECURITY CORRECTION (this revision): R1's `createEvidencePolicyEngine
// ({ trustedAttestors })` closed the property-cloning attack (WeakSet
// identity brand) but left the ROOT of trust itself caller-controlled — any
// module could call the same public factory with its own invented
// `{ sourceClass: 'REMOTE_REPOSITORY', strength: 'AUTHORITATIVE' }`
// attestor and mint CONFIRMED_P0 evidence, with or without the
// single-source exception. That factory is REMOVED entirely in this
// revision. There is no longer any public function that accepts a
// caller-chosen `sourceClass`/`strength` pair and returns evidence the
// policy evaluator will treat as trusted.
//
// In its place: a SINGLE, module-private `TRUSTED_EVIDENCE_REGISTRY`
// (WeakSet, keyed on object identity — unforgeable BRAND) that only two
// narrow, purpose-built ATTESTATION functions can add to (unforgeable
// ISSUER): `attestRemoteMainEvidence` and `attestFilesystemEvidence`. Both
// perform REAL verification by calling Improvement 1's own, unmodified
// gatherers (`gatherRemoteMainEvidence` / `gatherFilesystemEvidence` from
// `./source-of-truth.mjs`) — a caller supplies the MATERIAL needed for a
// real check (repoRoot, sha, relPath, rootDir, expectedRootCommit, ...),
// never the CONCLUSION (`sourceClass`/`strength`/`trusted`) itself.
// `sourceClass`/`strength` are assigned AFTER Improvement 1's real
// git/filesystem verification succeeds, from a fixed internal map — never
// from the caller's input. A caller who cannot make Improvement 1's real
// checks pass (wrong SHA, foreign repository, untracked path, symlink
// escape, identity mismatch — all of Improvement 1's own R1 gates apply
// unchanged) gets no evidence at all.
//
// For evidence classes that have no real gatherer yet (RUNTIME/CI/CLOUD/
// DATABASE/DOCUMENTATION/STATIC_CODE) — no attestation function is
// provided. Inventing one would mean fabricating verification that doesn't
// exist; per this project's own explicit instruction, such a class simply
// has no trusted attestor available until its real gatherer exists.
//
// R3 SECURITY CORRECTION (this revision) closes two findings an independent
// final reaudit reproduced against the R2 design:
//
//   IMP2-HISTSHA-001 (CRITICAL) — `attestRemoteMainEvidence` treated ANY
//   resolvable commit SHA as equally "AUTHORITATIVE current remote state",
//   with nothing distinguishing "this content existed at this commit" from
//   "this commit is the CURRENT tip of main right now". A real, 10-commit-
//   old ancestor of `main` attested identically to the real current tip,
//   and two such historical attestations alone reached CONFIRMED_P0. Fixed
//   by requiring the function to independently, REALLY query
//   `git ls-remote <remote> refs/heads/<branch>` itself (never trusting any
//   caller-supplied "this is current" value — a caller could otherwise set
//   both the attested SHA and an "expected current" parameter to the same
//   stale value) and refusing to attest unless the caller's `sha` exactly
//   matches that live-observed tip. A caller cannot choose the remote's
//   current state; the remote alone does.
//
//   IMP2-THRESHBYPASS-001 (HIGH) — R2's `evaluatePolicyThreshold` was a
//   public function returning the exact same `decision: 'CONFIRMED_P0'`
//   vocabulary as `evaluateClaim`, computed from bare, caller-supplied
//   strength labels with no evidence, no attestation, and no verification
//   at all. It has been REMOVED from this module's exports (and from the
//   file) entirely — `evaluateClaim` is now the only path in this module
//   capable of producing a `CONFIRMED_P0`/`CONFIRMED_P1` decision, and it
//   always requires real, trust-registry-backed evidence to do so. As a
//   consequence, P0/P1 threshold combinations that involve CORROBORATIVE
//   strength (no real gatherer produces CORROBORATIVE evidence yet) are no
//   longer exercised by a synthetic public shortcut; that coverage gap is
//   accepted deliberately in exchange for removing the bypass.
//
// Read-only Git/filesystem I/O happens inside the attestation functions
// (via Improvement 1's gatherers, plus one additional real, read-only
// `git ls-remote` query performed directly in this module for currentness
// verification) — this module is therefore NOT a zero-I/O module end to
// end, but the POLICY EVALUATOR (`evaluateClaim` and everything it calls)
// remains pure and deterministic; only attestation performs I/O, and only
// ever reads (never writes/fetches-as-in-mutates/spawns a shell for
// anything beyond a read-only ref lookup).
//
// R4 SECURITY CORRECTION (this revision) closes IMP2-TRANSPORT-001
// (CRITICAL), reproduced by an independent final reaudit of R3:
// `attestRemoteMainEvidence` correctly refused any `sha` that did not match
// a REAL `git ls-remote` currentness query — but that query, and the
// downstream `gatherRemoteMainEvidence` call, were both dispatched through a
// caller-suppliable `spawnSyncFn` parameter. A caller supplying its own
// `spawnSyncFn` (no shell access needed — plain JavaScript, since the
// parameter is simply a public function argument) could intercept ONLY the
// `ls-remote` call and report a stale/historical SHA as "current" while
// letting every other Git call pass through to the real `spawnSync` — the
// exact matching-stale-pair attack R3 believed it had closed, reopened one
// layer down, at the transport rather than the value. Two such forged
// AUTHORITATIVE attestations reached CONFIRMED_P0 in the reaudit's live
// reproduction.
//
// R3's design error, restated as this project's operating principle:
// CALLER_CAN_SUPPLY_OBSERVATION_DATA = YES (repoRoot/sha/relPath/rootDir/
// expectedRootCommit — the MATERIAL a real check runs against) but
// CALLER_CAN_SUPPLY_TRUST_DECISION_MECHANISM = NO (no function/callback that
// itself participates in deciding repository identity, SHA existence,
// current remote state, path existence, provenance, sourceClass, strength,
// or trusted-registry insertion). `spawnSyncFn` decided what "current"
// meant — it was a decision mechanism wearing a data parameter's name.
//
// Fixed by removing every executable dependency parameter from BOTH public
// attestation functions' contracts entirely: `attestRemoteMainEvidence` no
// longer accepts `spawnSyncFn`, `remoteName`, or `branchName` (remote/ref
// identity is now fixed to `origin`/`main` inside this module, never
// caller-selectable — a caller-controlled `remoteName` pointing at an
// attacker-controlled local path would have been an equivalent bypass, so
// closing only `spawnSyncFn` was insufficient); `attestFilesystemEvidence`
// no longer accepts `spawnSyncFn`, `existsSyncFn`, `readFileSyncFn`, or
// `realpathSyncFn`. Neither function forwards anything caller-supplied to
// Improvement 1's gatherers anymore — `gatherRemoteMainEvidence` and
// `gatherFilesystemEvidence` are called with only observation data, so they
// fall through to their OWN real, hardcoded default transports
// (`spawnSync`/`existsSync`/`readFileSync`/`realpathSync` from
// `source-of-truth.mjs`, unmodified). The currentness query itself now
// calls the real, directly-imported `spawnSync` from a private,
// unexported function with no injection point of any kind. If a caller
// passes any of the removed parameter names today, they are silently
// ignored (not read, not forwarded, no effect on the outcome) — verified by
// this module's own test suite.
//
// R5 SECURITY CORRECTION (this revision) closes IMP2-REMOTE-IDENTITY-001
// (CRITICAL), reproduced by an independent final reaudit of R4:
// `attestRemoteMainEvidence` no longer trusted a caller-suppliable callback,
// but it still trusted TWO things a caller controls without needing any
// callback at all — the `repoRoot` it points the function at, and whatever
// that `repoRoot`'s local `.git/config` currently defines as `origin`
// (`git remote set-url origin <anywhere>` is an ordinary, unprivileged git
// operation, not code injection). The reaudit reproduced two live attacks:
// (1) a fully synthetic, unrelated repository — its own history, its own
// fabricated `PROJECT_STATUS.md`, its own self-controlled `origin` — was
// attested `REMOTE_REPOSITORY`/`AUTHORITATIVE` with zero binding to the real
// project; (2) a genuine local clone of the real project, with `origin`
// reconfigured via `git remote set-url` to an attacker-controlled bare repo
// whose `main` was set to a real HISTORICAL (non-current) commit, attested
// that historical commit as current. Two such attestations reached
// CONFIRMED_P0 in both cases. Root cause: `origin` is a local NAME, not an
// identity, and R4 only ever hardcoded the name.
//
// This project's operating principle, extended: REPOSITORY_LOCATION (where
// a caller says a repo lives — `repoRoot`, always untrusted observation
// data) is not REPOSITORY_IDENTITY (which repository it actually is), and
// REMOTE_NAME (`origin`, a per-repo-config alias) is not REMOTE_IDENTITY
// (which URL that alias happens to resolve to today). Neither identity may
// be asserted by the caller, derived from `repoRoot`, or read from
// `repoRoot`'s own Git configuration.
//
// Fixed with a two-part CANONICAL trust anchor, both parts private,
// module-level constants — never exported, never parameters, never derived
// from `repoRoot` or its config:
//   - `CANONICAL_REMOTE_URL` (`https://github.com/<owner>/<repo>.git`) is
//     the ONLY location ever queried for "what is current" — via a direct
//     `git ls-remote <CANONICAL_REMOTE_URL> refs/heads/<CANONICAL_BRANCH>`
//     call that never runs with `-C repoRoot` (or any cwd derived from it),
//     so `repoRoot`'s local `origin` — reconfigured or not — is structurally
//     unreachable from this query. The subprocess env additionally strips
//     `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM`/`GIT_CONFIG_COUNT`/
//     `GIT_CONFIG_KEY_*`/`GIT_CONFIG_VALUE_*`/`GIT_DIR`/`GIT_WORK_TREE` and
//     forces `GIT_CONFIG_NOSYSTEM=1`, closing the one adjacent vector a
//     same-process JS caller (not just the repoRoot's own config) could
//     otherwise reach without any filesystem access at all: redirecting
//     this specific query via inherited process environment variables.
//     (Out of scope, per this revision's explicit threat model: an attacker
//     who already controls the host OS, replaces the `git` executable
//     itself, or compromises system DNS/TLS — defending against that is not
//     a Git-evidence-policy problem.)
//   - `CANONICAL_ROOT_COMMIT` is this project's real, immutable initial
//     commit SHA — the exact identity marker Improvement 1's own, unmodified
//     `verifyRepositoryIdentity` already uses and is reused here AS-IS (no
//     duplicate re-implementation): `repoRoot` must verify against this
//     constant before any content from it is trusted, so a synthetic
//     foreign repository (necessarily a different root commit) is refused
//     before the canonical currentness query is even consulted.
//
// The resulting flow is strictly sequential and fails closed at every step:
// UNTRUSTED repoRoot -> CANONICAL IDENTITY VERIFICATION (repoRoot's root
// commit == CANONICAL_ROOT_COMMIT) -> CANONICAL REMOTE CURRENTNESS (sha ==
// the live tip of CANONICAL_REMOTE_URL, queried independently of repoRoot)
// -> EXACT CONTENT VERIFICATION (Improvement 1's unmodified
// `gatherRemoteMainEvidence`, against repoRoot's real local objects) ->
// TRUSTED EVIDENCE. A caller can still say WHERE a repo lives (`repoRoot`)
// but can no longer say WHAT it is, WHICH remote is official, or WHAT that
// remote's current state is — no parameter of any name (`owner`, `repo`,
// `repositoryUrl`, `remoteUrl`, `canonicalUrl`, `expectedOriginUrl`,
// `remoteName`, `branchName`, `expectedRootCommit`, `canonicalRootCommit`,
// or any other) is read from `params` for this purpose; passing any of them
// has no effect whatsoever.
//
// POST-R5 SECURITY CORRECTION (this revision) closes IMP2-GITGLOBAL-001
// (CRITICAL), reproduced by an independent final reaudit of R5:
// `canonicalGitQueryEnv` stripped `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM`/
// etc. and forced `GIT_CONFIG_NOSYSTEM=1`, but never touched `HOME`/
// `USERPROFILE`/`XDG_CONFIG_HOME` — Git falls back to its NORMAL global
// config path the moment those specific redirection variables are absent,
// and that normal path is itself controlled by exactly the same kind of
// inherited, same-process-reachable environment variable this function
// already claimed to defend against. The reaudit set `HOME` to a directory
// containing a `.gitconfig` with `url.<attacker>.insteadOf =
// <CANONICAL_REMOTE_URL>` and the canonical `ls-remote` query silently
// resolved against the attacker's repo — no OS-level access, no code
// injection, a real HISTORICAL SHA reached `REMOTE_REPOSITORY`/
// `AUTHORITATIVE` and, with a second such attestation, `CONFIRMED_P0`.
//
// Fixed by giving the canonical query its own freshly-created, empty,
// unpredictably-named directory (`isolatedCanonicalGitHome`, via
// `mkdtempSync`) and pointing `HOME`/`USERPROFILE`/`XDG_CONFIG_HOME` at it
// — never at whatever the caller's inherited environment said — so there is
// structurally no global-config file for Git to find via any of those
// variables, removed again immediately after the one subprocess call. This
// is this module's one narrow, disclosed exception to "never writes": the
// directory is always empty, is never read from by this module, and exists
// only to be ABSENT of a `.gitconfig` for the duration of one query.
//
// IMPROVEMENT 3/5 (this revision) adds VERIFICATION LEVEL — a new axis,
// orthogonal to `sourceClass`/`strength`, answering "HOW was this checked?"
// rather than "WHERE from?" or "how strong?". The incident this closes: a
// Night Agent could read a `production-deploy.yml` (a STATIC inspection of
// declared config) and report "Production health check works" — or run
// `node --test` locally and report "Cloud Run Production responded" — with
// nothing in the evidence model distinguishing "I inspected an artifact"
// from "I actually observed this running" from "I only inferred this."
// `sourceClass`/`strength` alone cannot express this: `REMOTE_REPOSITORY`/
// `AUTHORITATIVE` evidence (Improvement 2's hardest-won tier) is a perfect
// example of something that is maximally trustworthy and yet was obtained
// entirely by STATIC content inspection (`git cat-file`) — it has never
// executed anything. Conflating "authoritative" with "observed running" was
// the latent gap.
//
// Four closed levels, reusing the enum-plus-strict-normalization pattern
// already established for `sourceClass`/`strength`/`supportsClaim`:
//   - `STATIC` — inspected an artifact (code, config, git content) without
//     executing the target system. Both of Improvement 2's real attestors
//     (`attestRemoteMainEvidence`, `attestFilesystemEvidence`) are STATIC —
//     hardcoded by this module, never caller-declared — because neither one
//     has ever executed anything; they only ever read committed/local
//     content, however authoritative that content is.
//   - `LOCAL_RUNTIME` — a real local/disposable execution actually
//     happened. `attestLocalRuntimeEvidence` (new) is the one real,
//     narrowly-scoped attestor: it can run exactly one thing —
//     `node --test <repo-relative-path>` inside an Improvement-1-identity-
//     verified `rootDir` — and reports the REAL exit code. No caller-
//     suppliable command, executable, or arguments of any kind; this keeps
//     the new execution surface as narrow as Improvement 1/2's git-
//     read-only surface, deliberately not a generic command runner.
//   - `REMOTE_RUNTIME` — the actual remote target was actually observed,
//     just now, with enough identity to know WHICH target.
//     `attestRemoteRuntimeEvidence` (new) performs a REAL HTTPS GET against
//     a caller-supplied `url` and mandates two target-binding fields that
//     cannot be omitted: `environment` (closed: `Development`/`Staging`/
//     `Production`) and `targetIdentity` (a non-empty label). Strength is
//     hardcoded to `DIRECT`, never `AUTHORITATIVE` — there is no canonical
//     anchor here the way `CANONICAL_REMOTE_URL` anchors remote-main; this
//     is a real, direct, but not canonically-pinned observation, and
//     `strength` must say so honestly.
//   - `INFERRED` — a reasoned conclusion, not a direct observation, even if
//     it cites real evidence via `derivedFromEvidenceIds`. No attestor
//     mints INFERRED — by definition it is never a real attestation, so it
//     only ever exists as raw, untrusted evidence (P0/P1 already excludes
//     untrusted evidence via `isTrusted`, so INFERRED structurally can
//     never confirm a P0/P1 claim on its own).
//
// The trust rule (`VERIFICATION_LEVEL_CANNOT_CREATE_AUTHORITY`) is
// asymmetric by design: a raw/untrusted evidence object claiming
// `verificationLevel: 'REMOTE_RUNTIME'` has that claim discarded (forced to
// `null`) exactly like an untrusted `sourceClass`/`strength` claim — but a
// raw object claiming `verificationLevel: 'INFERRED'` keeps that label,
// because declaring "I am only an inference" is a self-DOWNGRADE, not a
// privilege claim; there is nothing to protect against a caller who is
// honestly admitting their evidence is weaker than an observation.
//
// `evaluateClaim` gains two new, optional, orthogonal filters —
// `requiredVerificationLevels` (e.g. `['REMOTE_RUNTIME']`) and
// `requiredEnvironment` (e.g. `'Production'`) — applied AFTER the existing
// trust/supportsClaim/hierarchy filter and BEFORE clustering. Evidence that
// survives trust but fails this filter never silently falls through to the
// ordinary strength-based thresholds; it produces the new, explicit
// `HOLD_INSUFFICIENT_VERIFICATION_LEVEL` decision — evidence existed, just
// not of the kind (or targeting the environment) the claim required. This
// is what makes `LOCAL_RUNTIME` structurally unable to certify `Production`
// and `STATIC` structurally unable to certify anything "is running":
// neither promotion happens automatically, anywhere, by any mechanism.
//
// IMPROVEMENT_3_STALENESS_002_REMEDIATION (this revision) closes
// IMP3-STALENESS-002 (MEDIUM-HIGH), reproduced by an independent reaudit of
// NIGHT_REMEDIATION_1's `requiredMaxAgeMs`/`now` staleness fix
// (IMP3-STALENESS-001): that fix bound freshness to a `now` value, but
// `now` was ordinary CALLER-SUPPLIED DATA, exactly the class of defect this
// project's entire Improvement 2 saga exists to close (caller supplies the
// CONCLUSION, not just the MATERIAL). Live reproduction: a genuinely real,
// genuinely OLD `REMOTE_RUNTIME` observation was re-certified as
// CONFIRMED_P1 by simply asserting a `now` close to the evidence's own
// `observedAt`, regardless of how much real wall-clock time had actually
// passed — `requiredMaxAgeMs` offered no real guarantee at all against a
// caller willing to lie about the current time.
//
// Fixed by moving the wall-clock read to a PUBLIC SECURITY BOUNDARY that a
// caller cannot reach: `evaluateClaim` (exported) is now a thin wrapper —
// when `requiredMaxAgeMs` is used, it reads the REAL current time itself
// (`Date.now()`), once, and passes that as an explicit `trustedNowMs`
// argument into `evaluateClaimCore` (module-private, the actual decision
// logic, otherwise unchanged). No parameter name on `params` — not `now`,
// `currentTime`, `timestamp`, `clock`, `wallClock`, `dateNow`,
// `observedNow`, `trustedNow`, nor any nested/aliased/prototype-inherited
// spelling of any of them — is EVER read for this purpose; the trusted
// clock reading always comes from this function's own direct call, never
// from `params` in any shape.
//
// This deliberately ends this module's previous end-to-end purity claim for
// the PUBLIC `evaluateClaim` boundary specifically: `PUBLIC_POLICY_BOUNDARY
// _PURE = NO` is the honest, disclosed cost of a REAL freshness guarantee.
// `evaluateClaimCore` remains exactly as pure/deterministic as
// `evaluateClaim` was before this revision — it never touches the clock,
// filesystem, network, or `process` itself; it operates purely on its
// arguments, `trustedNowMs` included. Security took priority over
// preserving a "pure function" label that was no longer true in substance
// (a `now` nobody can verify is not a wall clock) — see this revision's own
// task framing for that explicit call.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { SOURCE_CLASSES, gatherRemoteMainEvidence, gatherFilesystemEvidence, verifyRepositoryIdentity } from './source-of-truth.mjs';

// ---------------------------------------------------------------------------
// R5 — the canonical trust anchor. Private, module-level, never exported,
// never a function parameter anywhere in this file, never derived from
// `repoRoot`/its config/environment variables a caller could set for a
// different purpose. This IS the root of trust IMP2-REMOTE-IDENTITY-001
// was missing.
// ---------------------------------------------------------------------------

const CANONICAL_REPOSITORY_OWNER = 'freddyestebancuervo';
const CANONICAL_REPOSITORY_NAME = 'rouvy_pro';
const CANONICAL_BRANCH = 'main';
const CANONICAL_REMOTE_URL = `https://github.com/${CANONICAL_REPOSITORY_OWNER}/${CANONICAL_REPOSITORY_NAME}.git`;
// This project's real, immutable initial commit SHA (`git rev-list
// --max-parents=0 HEAD`, verified against the live repository at the time
// this revision was written) — the same stable identity marker Improvement
// 1's `verifyRepositoryIdentity` already relies on for TARGET_WORKTREE/
// LOCAL_FILESYSTEM/HISTORICAL evidence, reused here unmodified rather than
// re-implemented.
const CANONICAL_ROOT_COMMIT = '7b5a2386c4b0b1b2cdc35a42c32fdbbf3f8816aa';

// POST-R5 SECURITY CORRECTION closes IMP2-GITGLOBAL-001 (CRITICAL),
// reproduced by an independent final reaudit of R5: `canonicalGitQueryEnv`
// stripped `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM`/etc. and forced
// `GIT_CONFIG_NOSYSTEM=1`, but never touched `HOME`/`USERPROFILE`/
// `XDG_CONFIG_HOME` — deleting `GIT_CONFIG_GLOBAL` does not stop Git from
// reading global config; it only stops that ONE env var from repointing it,
// and Git falls straight back to its normal, default global-config path
// (`$HOME/.gitconfig`, `$USERPROFILE/.gitconfig` on Windows if `HOME` is
// unset, `$XDG_CONFIG_HOME/git/config`) — every one of which is still an
// ordinary, same-process-reachable environment variable, exactly the class
// of vector this function already claimed to defend. The reaudit's
// reproduction: a caller sets `HOME` to a directory containing a
// `.gitconfig` with `url.<attacker-repo>.insteadOf = <CANONICAL_REMOTE_URL>`
// — no OS-level access, no code injection, just an inherited env var plus a
// normal-user-writable file — and the canonical `ls-remote` query silently
// resolved against the attacker's repo instead, minting a real HISTORICAL
// SHA as `REMOTE_REPOSITORY`/`AUTHORITATIVE`, reaching `CONFIRMED_P0` with
// two such attestations.
//
// Fixed by not merely stripping the REDIRECTION variables but by giving the
// canonical query its OWN, freshly-created, empty, unpredictably-named
// isolated home directory for `HOME`/`USERPROFILE`/`XDG_CONFIG_HOME` to
// point at — so there is no global-config FILE for Git to find via ANY of
// those variables, regardless of what the inherited ones said.
// `HOMEDRIVE`/`HOMEPATH` (git-for-windows' fallback pair when `HOME` is
// unset) are removed outright rather than pointed anywhere, since `HOME`
// being set always wins over them and leaving stale values serves no
// purpose. A per-call temp directory (never reused, removed immediately
// after the one subprocess call) is deliberately preferred over a fixed,
// predictable path like `os.tmpdir()` itself: a fixed path is a fixed
// target an attacker capable of writing files at all could pre-plant a
// `.gitconfig` into; `mkdtempSync`'s random suffix is not something a
// same-process caller can predict or race ahead of. This is this module's
// one narrow, disclosed exception to "never writes" (see the module header
// comment) — the directory this function creates is always empty, is never
// itself read from by this module, and exists only to be ABSENT of a
// `.gitconfig` for the duration of one subprocess call.
function isolatedCanonicalGitHome() {
  return mkdtempSync(path.join(tmpdir(), 'korixa-canonical-git-home-'));
}

// Strips the Git-config-redirection environment variables a CALLER running
// in the same Node process could set on `process.env` before invoking this
// module, THEN overrides every variable Git could use to locate a
// user/global config file with the freshly-created, empty `isolatedHome`
// (never the real, inherited `HOME`/`USERPROFILE`/`XDG_CONFIG_HOME`, which
// this function never even reads for this purpose). `GIT_CONFIG_NOSYSTEM`
// is additionally forced to `1` so the canonical query never depends on
// system-level `gitconfig` content either. This is deliberately narrow: it
// does not and cannot defend against an attacker who can write to this
// machine's global/system Git config files or replace the `git` executable
// — that is outside this module's threat model (see the R5 header comment).
function canonicalGitQueryEnv(isolatedHome) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      key === 'GIT_CONFIG_GLOBAL'
      || key === 'GIT_CONFIG_SYSTEM'
      || key === 'GIT_CONFIG_COUNT'
      || key === 'GIT_DIR'
      || key === 'GIT_WORK_TREE'
      || key === 'GIT_CEILING_DIRECTORIES'
      || key === 'HOMEDRIVE'
      || key === 'HOMEPATH'
      || key.startsWith('GIT_CONFIG_KEY_')
      || key.startsWith('GIT_CONFIG_VALUE_')
    ) {
      delete env[key];
    }
  }
  env.GIT_CONFIG_NOSYSTEM = '1';
  // Never the inherited values — always the freshly-created, empty,
  // unpredictable directory. This line is the actual fix: previously these
  // three were left as whatever `{ ...process.env }` copied in.
  env.HOME = isolatedHome;
  env.USERPROFILE = isolatedHome;
  env.XDG_CONFIG_HOME = isolatedHome;
  return env;
}

// Queries the CANONICAL remote directly by URL — never `-C repoRoot`, never
// a `cwd` derived from `repoRoot` or inherited from the calling process
// (which could itself be running from inside `repoRoot`). `os.tmpdir()` is
// used as a neutral working directory precisely because Git resolves local
// repo config by walking UP from cwd looking for `.git` — passing `-C`
// alone is not sufficient; the cwd itself must not be inside `repoRoot` (or
// any other repository whose config could interfere) either. The isolated
// home directory (see `isolatedCanonicalGitHome`/`canonicalGitQueryEnv`
// above) is created immediately before the subprocess call and removed
// immediately after, success or failure, via `finally` — it never persists
// beyond this one query.
function resolveCanonicalCurrentRemoteMainSha() {
  const isolatedHome = isolatedCanonicalGitHome();
  try {
    const result = spawnSync(
      'git',
      ['ls-remote', CANONICAL_REMOTE_URL, `refs/heads/${CANONICAL_BRANCH}`],
      { cwd: tmpdir(), env: canonicalGitQueryEnv(isolatedHome), encoding: 'utf8', shell: false },
    );
    if (!result || result.status !== 0 || typeof result.stdout !== 'string') return null;
    const lines = result.stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
    if (lines.length !== 1) return null;
    const candidate = lines[0].split(/\s+/)[0];
    return FROZEN_SHA_PATTERN.test(candidate) ? candidate : null;
  } finally {
    try {
      rmSync(isolatedHome, { recursive: true, force: true });
    } catch {
      // best-effort cleanup only — never lets a cleanup failure change the
      // resolved SHA or throw out of this function
    }
  }
}

// ---------------------------------------------------------------------------
// Enums — explicit, ranked where order matters. Never lexicographic.
// ---------------------------------------------------------------------------

export const EVIDENCE_CLASSES = Object.freeze([
  'REMOTE_REPOSITORY', 'TARGET_WORKTREE', 'LOCAL_FILESYSTEM', 'STATIC_CODE',
  'TEST_RUNTIME', 'APPLICATION_RUNTIME', 'CI_RUNTIME', 'CLOUD_RUNTIME',
  'DATABASE_RUNTIME', 'DOCUMENTATION', 'HISTORICAL', 'UNKNOWN',
]);

export const EVIDENCE_STRENGTHS = Object.freeze([
  'AUTHORITATIVE', 'DIRECT', 'CORROBORATIVE', 'INDIRECT', 'HISTORICAL', 'UNVERIFIED',
]);

// Explicit rank map — higher number = stronger. Never derived from array
// index/lexicographic order at call sites; always looked up through this map.
const STRENGTH_RANK = Object.freeze({
  AUTHORITATIVE: 5, DIRECT: 4, CORROBORATIVE: 3, INDIRECT: 2, HISTORICAL: 1, UNVERIFIED: 0,
});

export const SEVERITIES = Object.freeze(['P0', 'P1', 'P2', 'P3']);
export const CONFIDENCE_LEVELS = Object.freeze(['HIGH', 'MEDIUM', 'LOW', 'UNVERIFIED']);

export const DECISIONS = Object.freeze([
  'CONFIRMED_P0', 'CONFIRMED_P1', 'POTENTIAL_P0', 'POTENTIAL_P1',
  'P2', 'P3', 'HOLD_INSUFFICIENT_EVIDENCE', 'HOLD_CONFLICTING_EVIDENCE',
  'HOLD_INVALID_EVIDENCE_GRAPH', 'HOLD_UNTRUSTED_EVIDENCE', 'HOLD_DUPLICATE_EVIDENCE_ID',
  'HOLD_INSUFFICIENT_VERIFICATION_LEVEL',
  'UNVERIFIED',
]);

// ---------------------------------------------------------------------------
// Improvement 3/5 — VERIFICATION LEVEL. Closed catalog, exactly these four,
// nothing else; a `verificationLevel` of any other value (including common
// near-misses like `'runtime'`, `'REMOTE'`, `'production'`, `'verified'`, or
// non-string values like `null`/`{}`/`1`/`true`) is never silently coerced
// into one of these — see `normalizeVerificationLevel` below.
// ---------------------------------------------------------------------------

export const VERIFICATION_LEVELS = Object.freeze(['STATIC', 'LOCAL_RUNTIME', 'REMOTE_RUNTIME', 'INFERRED']);

// The subset of VERIFICATION_LEVELS that represent a real, direct
// OBSERVATION (as opposed to a reasoned conclusion). Only these three are
// subject to the trust gate below — claiming to have observed something is
// a privilege claim; admitting a conclusion is merely inferred is not.
const OBSERVED_VERIFICATION_LEVELS = Object.freeze(['STATIC', 'LOCAL_RUNTIME', 'REMOTE_RUNTIME']);

// Closed catalog for `environment` — only ever set by `attestRemoteRuntimeEvidence`.
export const ENVIRONMENTS = Object.freeze(['Development', 'Staging', 'Production']);

// R3 (VERIFICATION_LEVEL_CANNOT_CREATE_AUTHORITY): mirrors the
// sourceClass/strength trust gate exactly, with one deliberate asymmetry.
// `STATIC`/`LOCAL_RUNTIME`/`REMOTE_RUNTIME` are OBSERVATION claims — an
// untrusted (raw, non-attested) evidence object self-declaring any of them
// has that claim discarded (forced to `null`), exactly like an untrusted
// `sourceClass: 'REMOTE_REPOSITORY'` is forced to `'UNKNOWN'`. `INFERRED`
// is not an observation claim — it is an admission that no direct
// observation was made — so it is preserved regardless of trust; there is
// no authority to fabricate by saying "this is merely inferred."
function normalizeVerificationLevel(rawValue, isTrusted) {
  const declared = VERIFICATION_LEVELS.includes(rawValue) ? rawValue : null;
  if (declared === 'INFERRED') return { declared, governing: 'INFERRED' };
  if (declared !== null && OBSERVED_VERIFICATION_LEVELS.includes(declared)) {
    return { declared, governing: isTrusted ? declared : null };
  }
  return { declared: null, governing: null };
}

// `environment`/`targetIdentity` follow the same trust gate as
// sourceClass/strength — only ever meaningful/preserved for TRUSTED
// evidence (real attestation via `attestRemoteRuntimeEvidence`); a raw
// caller cannot fabricate `environment: 'Production'` to slip past
// `evaluateClaim`'s `requiredEnvironment` filter.
function normalizeTrustGatedString(rawValue, isTrusted) {
  if (!isTrusted) return null;
  return typeof rawValue === 'string' && rawValue.length > 0 ? rawValue : null;
}

const EVIDENCE_ID_MAX_LENGTH = 256;
const REASON_MIN_LENGTH = 12;
const REASON_MAX_LENGTH = 1000;

// Maps the subset of EVIDENCE_CLASSES that correspond to Improvement 1's
// file-state hierarchy onto Improvement 1's own class names, so conflicts
// between (e.g.) REMOTE_REPOSITORY and LOCAL_FILESYSTEM evidence can be
// adjudicated by the SAME priority order Improvement 1 already owns —
// consumed via the imported `SOURCE_CLASSES` array, never re-declared.
const HIERARCHY_CLASS_MAP = Object.freeze({
  REMOTE_REPOSITORY: 'REMOTE_MAIN',
  TARGET_WORKTREE: 'TARGET_WORKTREE',
  LOCAL_FILESYSTEM: 'LOCAL_ROOT',
  HISTORICAL: 'HISTORICAL',
});

function hierarchyRank(evidenceClass) {
  const mapped = HIERARCHY_CLASS_MAP[evidenceClass];
  if (!mapped) return null;
  const idx = SOURCE_CLASSES.indexOf(mapped);
  return idx === -1 ? null : idx;
}

// ---------------------------------------------------------------------------
// Fingerprints — pure string/hash construction only. No I/O. Output is
// always a one-way SHA-256 hex digest. Each component is encoded as its own
// JSON string inside a JSON array, so field boundaries are unambiguous
// regardless of what characters (including NUL) appear inside a component —
// no character-shift across a field boundary can produce the same encoded
// text for two structurally different tuples (IMP2-FP-001, closed; verified
// again below not to have regressed).
// ---------------------------------------------------------------------------

function toFingerprintComponent(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    throw new TypeError('fingerprint component must be a string, null, or undefined');
  }
  return value;
}

function canonicalFingerprint(domain, rawComponents) {
  const components = rawComponents.map(toFingerprintComponent);
  const canonical = JSON.stringify([domain, ...components]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function buildGitFingerprint({ repositoryIdentity, sha, path }) {
  return canonicalFingerprint('git', [repositoryIdentity, sha, path]);
}

export function buildFilesystemFingerprint({ canonicalRepositoryIdentity, canonicalPath, contentHash }) {
  return canonicalFingerprint('fs', [canonicalRepositoryIdentity, canonicalPath, contentHash]);
}

export function buildRuntimeFingerprint({ executionId, resource, observationType }) {
  return canonicalFingerprint('runtime', [executionId, resource, observationType]);
}

export function buildCiFingerprint({ runId, jobId, observation }) {
  return canonicalFingerprint('ci', [runId, jobId, observation]);
}

// ---------------------------------------------------------------------------
// evidenceId validation — shared by attested and raw evidence.
// ---------------------------------------------------------------------------

function isValidEvidenceId(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= EVIDENCE_ID_MAX_LENGTH;
}

// ---------------------------------------------------------------------------
// R2 fix (IMP2-BOOL-002) — supportsClaim is now a STRICT boolean with no
// default. R1 treated an OMITTED field as "supports" (`undefined -> true`);
// an independent reaudit correctly identified this as fail-OPEN for a
// module whose entire purpose is preventing accidental over-confirmation —
// a gatherer bug that forgets to set `supportsClaim: false` would silently
// turn a contradiction into support. Every evidence entry, attested or raw,
// must now explicitly state `true` or `false`; anything else (including
// omission) is invalid and excluded from counting.
// ---------------------------------------------------------------------------

function normalizeSupportsClaim(raw) {
  if (typeof raw === 'boolean') return { value: raw, valid: true };
  return { value: null, valid: false };
}

// ---------------------------------------------------------------------------
// Evidence normalization — defensive against untrusted content. `isTrusted`
// is determined by the CALLER of this function (via WeakSet identity check
// on the ORIGINAL raw object, before this function ever runs) and is never
// derived from anything inside `raw` itself. When `isTrusted` is false,
// `sourceClass`/`strength` are FORCED to the weakest safe values regardless
// of what `raw` claims — the raw self-declared values are preserved
// separately, under `declaredSourceClass`/`declaredStrength`, for audit
// transparency only; they never participate in any decision.
// ---------------------------------------------------------------------------

function normalizeEvidence(raw, index, isTrusted) {
  const providedId = isValidEvidenceId(raw?.evidenceId);
  const evidenceId = providedId ? raw.evidenceId : `__unnamed_evidence_${index}__`;

  const declaredSourceClass = EVIDENCE_CLASSES.includes(raw?.sourceClass) ? raw.sourceClass : 'UNKNOWN';
  const declaredStrength = EVIDENCE_STRENGTHS.includes(raw?.strength) ? raw.strength : 'UNVERIFIED';

  const fingerprint = typeof raw?.sourceFingerprint === 'string' && raw.sourceFingerprint.length > 0 ? raw.sourceFingerprint : null;
  const derivedFromEvidenceIds = Array.isArray(raw?.derivedFromEvidenceIds)
    ? raw.derivedFromEvidenceIds.filter((x) => typeof x === 'string' && x.length > 0)
    : [];
  const supportsClaimResult = normalizeSupportsClaim(raw?.supportsClaim);
  const verificationLevelResult = normalizeVerificationLevel(raw?.verificationLevel, isTrusted);

  return {
    evidenceId,
    evidenceIdWasProvided: providedId,
    isTrusted,
    // DEFECT IMP2-AUTH-001 fix: sourceClass/strength are the values that
    // actually drive every decision downstream, and they are NEVER taken
    // from `raw` unless this evidence passed through a real attestation
    // function for THIS exact object reference.
    sourceClass: isTrusted ? declaredSourceClass : 'UNKNOWN',
    strength: isTrusted ? declaredStrength : 'UNVERIFIED',
    declaredSourceClass,
    declaredStrength,
    // Improvement 3/5: same trust-gate shape as sourceClass/strength, with
    // the INFERRED exception documented on `normalizeVerificationLevel`.
    verificationLevel: verificationLevelResult.governing,
    declaredVerificationLevel: verificationLevelResult.declared,
    environment: normalizeTrustGatedString(raw?.environment, isTrusted),
    targetIdentity: normalizeTrustGatedString(raw?.targetIdentity, isTrusted),
    // NIGHT_REMEDIATION_1 (IMP3-STALENESS-001): trust-gated exactly like
    // environment/targetIdentity — an untrusted/raw caller must never be
    // able to fabricate a fresh-looking `observedAt` to slip past
    // `evaluateClaim`'s `requiredMaxAgeMs` staleness filter.
    observedAt: normalizeTrustGatedString(raw?.observedAt, isTrusted),
    sourceId: typeof raw?.sourceId === 'string' ? raw.sourceId : null,
    sourceFingerprint: fingerprint,
    supportsClaim: supportsClaimResult.value,
    supportsClaimInvalid: !supportsClaimResult.valid,
    derivedFromEvidenceIds,
    timestamp: raw?.timestamp ?? null,
    verificationMethod: typeof raw?.verificationMethod === 'string' ? raw.verificationMethod : null,
  };
}

function hasFingerprint(e) {
  return typeof e.sourceFingerprint === 'string' && e.sourceFingerprint.length > 0;
}

// ---------------------------------------------------------------------------
// Duplicate evidenceId detection (IMP2-DUPID-001, closed) — any evidenceId
// that was explicitly provided (not the synthetic per-index fallback) and
// appears more than once fails the whole evaluation closed, before cycle
// detection or clustering ever run.
// ---------------------------------------------------------------------------

function detectDuplicateEvidenceIds(normalizedList) {
  const seen = new Map();
  for (const e of normalizedList) {
    if (!e.evidenceIdWasProvided) continue;
    seen.set(e.evidenceId, (seen.get(e.evidenceId) ?? 0) + 1);
  }
  const duplicateIds = [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  return { hasDuplicates: duplicateIds.length > 0, duplicateIds };
}

// ---------------------------------------------------------------------------
// Derivation graph — cycle detection. A self-derived or mutually-derived
// pair of evidence entries must never be silently accepted.
// ---------------------------------------------------------------------------

function detectDerivationCycle(evidenceList) {
  const byId = new Map(evidenceList.map((e) => [e.evidenceId, e]));
  const visiting = new Set();
  const visited = new Set();
  let cycleIds = null;

  function visit(id, stack) {
    if (cycleIds) return;
    if (visiting.has(id)) {
      cycleIds = [...stack, id];
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const e = byId.get(id);
    for (const parentId of e?.derivedFromEvidenceIds || []) {
      if (byId.has(parentId)) visit(parentId, [...stack, id]);
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const e of evidenceList) visit(e.evidenceId, []);
  return { hasCycle: !!cycleIds, cycleIds: cycleIds || [] };
}

function isDerivedFrom(a, b) {
  return Array.isArray(a?.derivedFromEvidenceIds) && a.derivedFromEvidenceIds.includes(b?.evidenceId);
}

// ---------------------------------------------------------------------------
// sameUnderlyingSource — two evidence entries are the SAME underlying
// source (never count as independent of each other) if either:
//   - they share an identical, non-empty sourceFingerprint, or
//   - one is (directly) derived from the other.
// If neither can be positively demonstrated, this returns false — but
// fingerprint-less evidence is separately excluded from independence
// counting entirely, regardless of what this pairwise check reports.
// ---------------------------------------------------------------------------

export function sameUnderlyingSource(e1, e2) {
  if (!e1 || !e2) return false;
  if (isDerivedFrom(e1, e2) || isDerivedFrom(e2, e1)) return true;
  if (hasFingerprint(e1) && hasFingerprint(e2)) {
    return e1.sourceFingerprint === e2.sourceFingerprint;
  }
  return false;
}

function clusterEligibleEvidence(evidenceList) {
  const eligible = evidenceList.filter(hasFingerprint);
  const parent = new Map(eligible.map((e) => [e.evidenceId, e.evidenceId]));

  function find(x) {
    while (parent.get(x) !== x) x = parent.get(x);
    return x;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  for (let i = 0; i < eligible.length; i += 1) {
    for (let j = i + 1; j < eligible.length; j += 1) {
      if (sameUnderlyingSource(eligible[i], eligible[j])) union(eligible[i].evidenceId, eligible[j].evidenceId);
    }
  }

  const groups = new Map();
  for (const e of eligible) {
    const root = find(e.evidenceId);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(e);
  }
  return [...groups.values()];
}

function clusterMaxStrength(cluster) {
  return cluster.reduce((best, e) => (STRENGTH_RANK[e.strength] > STRENGTH_RANK[best] ? e.strength : best), 'UNVERIFIED');
}

// ---------------------------------------------------------------------------
// Conflict analysis. Evidence with `supportsClaim: false` contradicts the
// claim. When a contradicting/supporting pair's classes both map into
// Improvement 1's file-state hierarchy, that hierarchy adjudicates the
// conflict (the lower-priority side is excluded from counting, but the
// conflict is NOT "unresolved"). When either side's class is outside the
// hierarchy, the disagreement cannot be ranked away — it is a genuine,
// unresolved conflict.
// ---------------------------------------------------------------------------

function analyzeConflicts(normalizedEvidence) {
  const supporting = normalizedEvidence.filter((e) => e.supportsClaim === true && !e.supportsClaimInvalid);
  const contradicting = normalizedEvidence.filter((e) => e.supportsClaim === false && !e.supportsClaimInvalid);
  const unresolvedConflicts = [];
  const hierarchyResolutions = [];
  const hierarchyLosers = new Set();

  for (const s of supporting) {
    for (const c of contradicting) {
      const sRank = hierarchyRank(s.sourceClass);
      const cRank = hierarchyRank(c.sourceClass);
      if (sRank !== null && cRank !== null && sRank !== cRank) {
        const sWins = sRank < cRank; // lower index = higher priority in SOURCE_CLASSES
        hierarchyLosers.add(sWins ? c.evidenceId : s.evidenceId);
        hierarchyResolutions.push({
          evidenceIdA: s.evidenceId,
          evidenceIdB: c.evidenceId,
          resolvedByHierarchy: true,
          winnerEvidenceId: sWins ? s.evidenceId : c.evidenceId,
        });
      } else {
        unresolvedConflicts.push({ evidenceIdA: s.evidenceId, evidenceIdB: c.evidenceId, resolvedByHierarchy: false });
      }
    }
  }

  return { unresolvedConflicts, hierarchyResolutions, hierarchyLosers };
}

// ---------------------------------------------------------------------------
// Confidence — a pure function of evidence facts, computed independently of
// the severity a caller requested. SEVERITY and CONFIDENCE are separate
// axes; a P0 request with LOW confidence must never confirm.
// ---------------------------------------------------------------------------

function computeConfidence({ count, strengthsDesc }) {
  if (count === 0) return 'UNVERIFIED';
  if (count === 1) {
    const s = strengthsDesc[0];
    if (s === 'AUTHORITATIVE' || s === 'DIRECT') return 'MEDIUM';
    if (s === 'CORROBORATIVE' || s === 'INDIRECT') return 'LOW';
    return 'UNVERIFIED';
  }
  const [top, second] = strengthsDesc;
  if (STRENGTH_RANK[top] >= STRENGTH_RANK.DIRECT && STRENGTH_RANK[second] >= STRENGTH_RANK.CORROBORATIVE) return 'HIGH';
  if (STRENGTH_RANK[top] >= STRENGTH_RANK.CORROBORATIVE && STRENGTH_RANK[second] >= STRENGTH_RANK.CORROBORATIVE) return 'MEDIUM';
  return 'LOW';
}

function isValidSingleSourceReason(reason) {
  if (typeof reason !== 'string') return false;
  const trimmed = reason.trim();
  return trimmed.length >= REASON_MIN_LENGTH && trimmed.length <= REASON_MAX_LENGTH;
}

// The pure decision core. Operates ONLY on already-abstracted cluster
// summaries ({maxStrength} per independent cluster) — never on raw evidence
// objects, never touches TRUSTED_EVIDENCE_REGISTRY. This is what makes it
// safe to also expose (via `evaluatePolicyThreshold` below) as a testing
// surface for severity classes that have no real attestor yet: there is no
// path from calling this function to `evaluateClaim` treating anything as
// trusted, because `evaluateClaim` never accepts caller-supplied clusters —
// it always computes them itself from the trusted-only evidence subset.
function decideOutcome({ severity, effectiveClusters, unresolvedConflicts, totalEvidenceCount, singleSourceExceptionRequested, singleSourceExceptionReason }) {
  if (unresolvedConflicts.length > 0) {
    return {
      decision: 'HOLD_CONFLICTING_EVIDENCE',
      confidence: 'UNVERIFIED',
      decisionReason: 'unresolved_conflicting_evidence',
      singleSourceExceptionUsed: false,
    };
  }

  const strengthsDesc = effectiveClusters
    .map((c) => c.maxStrength)
    .sort((a, b) => STRENGTH_RANK[b] - STRENGTH_RANK[a]);
  const count = effectiveClusters.length;
  const confidence = computeConfidence({ count, strengthsDesc });

  if (severity === 'P0' || severity === 'P1') {
    const meetsDoubleBar = severity === 'P0'
      ? count >= 2 && STRENGTH_RANK[strengthsDesc[0]] >= STRENGTH_RANK.DIRECT && STRENGTH_RANK[strengthsDesc[1]] >= STRENGTH_RANK.CORROBORATIVE
      : count >= 2 && STRENGTH_RANK[strengthsDesc[0]] >= STRENGTH_RANK.CORROBORATIVE && STRENGTH_RANK[strengthsDesc[1]] >= STRENGTH_RANK.CORROBORATIVE;

    if (meetsDoubleBar) {
      return {
        decision: severity === 'P0' ? 'CONFIRMED_P0' : 'CONFIRMED_P1',
        confidence: 'HIGH',
        decisionReason: 'double_independent_trusted_evidence_threshold_met',
        singleSourceExceptionUsed: false,
      };
    }

    if (count === 1 && singleSourceExceptionRequested) {
      const soleStrength = strengthsDesc[0];
      const eligible = soleStrength === 'AUTHORITATIVE' || soleStrength === 'DIRECT';
      const hasReason = isValidSingleSourceReason(singleSourceExceptionReason);
      if (eligible && hasReason) {
        return {
          decision: severity === 'P0' ? 'CONFIRMED_P0' : 'CONFIRMED_P1',
          confidence: 'HIGH',
          decisionReason: 'single_source_exception_justified',
          singleSourceExceptionUsed: true,
        };
      }
    }

    if (count === 0) {
      if (totalEvidenceCount > 0) {
        return { decision: 'HOLD_UNTRUSTED_EVIDENCE', confidence: 'UNVERIFIED', decisionReason: 'no_trusted_effective_evidence', singleSourceExceptionUsed: false };
      }
      return { decision: 'HOLD_INSUFFICIENT_EVIDENCE', confidence: 'UNVERIFIED', decisionReason: 'no_effective_evidence', singleSourceExceptionUsed: false };
    }
    if (strengthsDesc.every((s) => STRENGTH_RANK[s] <= STRENGTH_RANK.HISTORICAL)) {
      return { decision: 'HOLD_INSUFFICIENT_EVIDENCE', confidence, decisionReason: 'evidence_too_weak_for_potential', singleSourceExceptionUsed: false };
    }
    return {
      decision: severity === 'P0' ? 'POTENTIAL_P0' : 'POTENTIAL_P1',
      confidence,
      decisionReason: 'below_double_independent_evidence_threshold',
      singleSourceExceptionUsed: false,
    };
  }

  // P2 / P3 — trust is not required (low-risk findings may rely on a
  // single, lower-confidence, self-reported observation), but a single
  // piece of real evidence must never present artificial certainty:
  // count===1 is always LOW.
  if (count === 0) {
    return { decision: 'HOLD_INSUFFICIENT_EVIDENCE', confidence: 'UNVERIFIED', decisionReason: 'no_effective_evidence', singleSourceExceptionUsed: false };
  }
  return {
    decision: severity,
    confidence: count === 1 ? 'LOW' : confidence,
    decisionReason: count === 1 ? 'single_evidence_low_severity' : 'multiple_evidence_low_severity',
    singleSourceExceptionUsed: false,
  };
}

// R3 SECURITY CORRECTION (IMP2-THRESHBYPASS-001): the public pure-math
// testing utility that used to live here (`evaluatePolicyThreshold`) has
// been REMOVED. It returned the same `decision: 'CONFIRMED_P0'` vocabulary
// as `evaluateClaim` from bare, caller-supplied strength labels alone — no
// evidence, no attestation, no verification — making it a second, unguarded
// public path to an apparently-authoritative verdict. `decideOutcome`/
// `computeConfidence` above remain internal (never exported) and are only
// ever invoked by `evaluateClaim` itself, against real, trust-registry-
// verified evidence. The accepted consequence: P0/P1 threshold
// combinations involving CORROBORATIVE strength (no real gatherer produces
// CORROBORATIVE evidence yet) are not directly exercised by a synthetic
// shortcut in this module's own test suite — removing the bypass takes
// priority over that specific coverage.

// ---------------------------------------------------------------------------
// The trust boundary. `TRUSTED_EVIDENCE_REGISTRY` is a module-private
// WeakSet — never exported, never derivable from any property on an
// evidence object (BRAND_UNFORGEABLE). The ONLY two functions that can add
// to it are `attestRemoteMainEvidence` and `attestFilesystemEvidence`
// below, and both require Improvement 1's REAL verification to succeed
// first (ISSUER_UNFORGEABLE_BY_NORMAL_CALLER) — there is no public factory,
// registry, or configuration parameter through which a caller can define a
// new privileged attestor or source class.
// ---------------------------------------------------------------------------

const TRUSTED_EVIDENCE_REGISTRY = new WeakSet();

function isPlainParamsObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// A "current" observation must be a canonical 40-lowercase-hex SHA — the
// exact same policy source-of-truth.mjs already applies to its own frozen
// SHAs, applied here independently (this module does not import that
// private pattern from Improvement 1; it is a one-line, self-contained
// format check, not a re-implementation of any of Improvement 1's actual
// verification logic).
const FROZEN_SHA_PATTERN = /^[0-9a-f]{40}$/;

function finalizeAttestedEvidence({
  evidenceId, sourceClass, strength, verificationLevel, sourceFingerprint, supportsClaim,
  derivedFromEvidenceIds, timestamp, verificationMethod,
  environment = null, targetIdentity = null, observedStatusCode = null, observedAt = null, observedExitCode = null,
}) {
  const evidenceObject = Object.freeze({
    evidenceId,
    sourceClass,
    strength,
    // Improvement 3/5: always assigned here, by the attestor itself, from a
    // fixed internal value — NEVER from caller input — exactly like
    // sourceClass/strength above.
    verificationLevel,
    sourceFingerprint,
    supportsClaim,
    derivedFromEvidenceIds: Array.isArray(derivedFromEvidenceIds) ? derivedFromEvidenceIds.filter((x) => typeof x === 'string' && x.length > 0) : [],
    timestamp: timestamp ?? null,
    verificationMethod,
    // Target-binding fields (Improvement 3/5) — null except for
    // attestRemoteRuntimeEvidence (environment/targetIdentity/
    // observedStatusCode/observedAt) and attestLocalRuntimeEvidence
    // (observedExitCode).
    environment,
    targetIdentity,
    observedStatusCode,
    observedAt,
    observedExitCode,
  });
  TRUSTED_EVIDENCE_REGISTRY.add(evidenceObject);
  return evidenceObject;
}

/**
 * The ONLY way to produce REMOTE_REPOSITORY/AUTHORITATIVE trusted evidence.
 * Calls Improvement 1's unmodified `gatherRemoteMainEvidence` — a caller
 * supplies `repoRoot`/`sha`/`relPath` (the MATERIAL needed for a real Git
 * check), never `sourceClass`/`strength`/`trusted` (the CONCLUSION). A
 * historical-but-valid SHA, a symbolic ref, a foreign repository, or an
 * untracked path all fail exactly as Improvement 1's own gates dictate —
 * this function adds no leniency of its own on top of them.
 *
 * R3 (IMP2-HISTSHA-001): additionally, `sha` must match the CURRENT tip of
 * `refs/heads/main`, resolved via this function's OWN independent
 * `git ls-remote` call — never via any caller-asserted "this is current"
 * value. A real, resolvable, but non-current commit (e.g. an ancestor of
 * `main`) is refused with `NOT_CURRENT_REMOTE_MAIN`; this is the exact
 * distinction between "this content existed in the repository" and "this is
 * the frozen, current official state" that the original incident (and this
 * reaudit) turned on.
 * R4 (IMP2-TRANSPORT-001): this function's parameter object accepts ONLY
 * observation data. It does not accept, read, or forward any executable
 * dependency — no `spawnSyncFn` override — to itself or to
 * `gatherRemoteMainEvidence`. If it is present on `params`, it is simply
 * never read — silently ignored, with no effect on the outcome.
 * R5 (IMP2-REMOTE-IDENTITY-001): `origin` — a local, per-repo-config alias
 * — is never consulted for currentness, and `repoRoot` is never trusted as
 * "the real project" merely because a caller says so. Two things happen
 * that did not happen before, both against PRIVATE, code-defined constants,
 * never against anything in `params`: (1) `repoRoot` must verify, via
 * Improvement 1's own unmodified `verifyRepositoryIdentity`, as the SAME
 * repository as `CANONICAL_ROOT_COMMIT` — a synthetic/foreign repository
 * (necessarily a different root commit) is refused with
 * `HOLD_REPOSITORY_IDENTITY_UNVERIFIED:<reason>` before anything else runs;
 * (2) currentness is resolved by querying `CANONICAL_REMOTE_URL` directly —
 * never `repoRoot`'s local `origin`, reconfigured or not. No parameter named
 * `owner`/`repo`/`repositoryUrl`/`remoteUrl`/`canonicalUrl`/
 * `expectedOriginUrl`/`remoteName`/`branchName`/`expectedRootCommit`/
 * `canonicalRootCommit` (or anything else) is read from `params` for this
 * purpose — passing any of them has no effect whatsoever.
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.sha 40-lowercase-hex commit SHA, must match the live-observed current tip of the canonical repository's main
 * @param {string} params.relPath
 * @param {string} params.evidenceId
 * @param {boolean} params.supportsClaim strict boolean, required
 * @param {string[]} [params.derivedFromEvidenceIds]
 * @param {unknown} [params.timestamp]
 * @param {string} [params.verificationMethod]
 * @returns {{evidence: object|null, error: string|null}}
 */
export function attestRemoteMainEvidence(params) {
  if (!isPlainParamsObject(params)) {
    return { evidence: null, error: 'INVALID_OBSERVATION' };
  }
  const {
    repoRoot, sha, relPath, evidenceId, supportsClaim, derivedFromEvidenceIds, timestamp, verificationMethod,
  } = params;

  if (!isValidEvidenceId(evidenceId)) {
    return { evidence: null, error: 'INVALID_EVIDENCE_ID' };
  }
  const supportsClaimResult = normalizeSupportsClaim(supportsClaim);
  if (!supportsClaimResult.valid) {
    return { evidence: null, error: 'INVALID_SUPPORTS_CLAIM' };
  }

  // R5, step 1: CANONICAL IDENTITY VERIFICATION. `repoRoot` must be the
  // canonical repository before its content is trusted for anything —
  // `expectedRootCommit` here is ALWAYS this module's own private constant,
  // never anything from `params`. Improvement 1's gatherer/logic is reused
  // unmodified (no `spawnSyncFn` forwarded — real transport only).
  const identity = verifyRepositoryIdentity({ rootDir: repoRoot, expectedRootCommit: CANONICAL_ROOT_COMMIT });
  if (!identity.verified) {
    return { evidence: null, error: `HOLD_REPOSITORY_IDENTITY_UNVERIFIED:${identity.reason}` };
  }

  // R5, step 2: CANONICAL REMOTE CURRENTNESS. Queried against
  // CANONICAL_REMOTE_URL directly — repoRoot and its local `origin` (however
  // configured) play no part in this call at all.
  const observedCurrentSha = resolveCanonicalCurrentRemoteMainSha();
  if (!observedCurrentSha) {
    return { evidence: null, error: 'CURRENT_REMOTE_MAIN_UNRESOLVED' };
  }
  if (!FROZEN_SHA_PATTERN.test(sha) || sha !== observedCurrentSha) {
    return { evidence: null, error: 'NOT_CURRENT_REMOTE_MAIN' };
  }

  // R5, step 3: EXACT CONTENT VERIFICATION. repoRoot must actually contain
  // the canonical-current object/path locally — no spawnSyncFn forwarded,
  // gatherRemoteMainEvidence falls through to its own real, hardcoded
  // default transport (source-of-truth.mjs, unmodified).
  const gathered = gatherRemoteMainEvidence({ repoRoot, sha, relPath });
  if (typeof gathered.content !== 'string') {
    return { evidence: null, error: `SOURCE_OF_TRUTH_UNVERIFIED:${gathered.resolutionStatus}` };
  }

  const evidence = finalizeAttestedEvidence({
    evidenceId,
    sourceClass: 'REMOTE_REPOSITORY',
    strength: 'AUTHORITATIVE',
    // Improvement 3/5: this is content inspection (`git cat-file`), never
    // execution — AUTHORITATIVE and STATIC are orthogonal, not synonyms.
    verificationLevel: 'STATIC',
    sourceFingerprint: buildGitFingerprint({ repositoryIdentity: repoRoot, sha, path: relPath }),
    supportsClaim: supportsClaimResult.value,
    derivedFromEvidenceIds,
    timestamp,
    verificationMethod: typeof verificationMethod === 'string' ? verificationMethod : 'source-of-truth:gatherRemoteMainEvidence',
  });
  return { evidence, error: null };
}

// The ONLY sourceClasses attestFilesystemEvidence may issue — fixed,
// internal, never caller-parameterized. Each maps to Improvement 1's own
// source-of-truth class name (for the real gatherer call) and a FIXED
// strength; a caller chooses which of these three real, gatherer-backed
// classes applies to their material, never an arbitrary class/strength pair.
const FILESYSTEM_ATTESTABLE_CLASSES = Object.freeze({
  TARGET_WORKTREE: Object.freeze({ sotClass: 'TARGET_WORKTREE', strength: 'DIRECT' }),
  LOCAL_FILESYSTEM: Object.freeze({ sotClass: 'LOCAL_ROOT', strength: 'DIRECT' }),
  HISTORICAL: Object.freeze({ sotClass: 'HISTORICAL', strength: 'HISTORICAL' }),
});

/**
 * The ONLY way to produce TARGET_WORKTREE/LOCAL_FILESYSTEM/HISTORICAL
 * trusted evidence. Calls Improvement 1's unmodified `gatherFilesystemEvidence`
 * — a caller supplies `rootDir`/`relPath`/`expectedRootCommit` (the material
 * for a real repository-identity + path-safety + symlink check), never the
 * resulting `strength`. `sourceClass` is restricted to the three fixed
 * values above; anything else is rejected before any filesystem access. A
 * foreign repository, a path-traversal attempt, a symlink escape, or a
 * missing/invalid `expectedRootCommit` all fail exactly as Improvement 1's
 * own R1 gates dictate.
 * R4 (IMP2-TRANSPORT-001): this function's parameter object accepts ONLY
 * observation data. It no longer accepts `spawnSyncFn`, `existsSyncFn`,
 * `readFileSyncFn`, or `realpathSyncFn` — the R3 version forwarded any of
 * these that were function-typed straight into `gatherFilesystemEvidence`,
 * which is exactly the class of bypass R4 closes on the remote-main side
 * (a caller-controlled transport deciding path existence/content/provenance
 * for evidence this function then marks trusted). If any of the removed
 * parameter names are present on `params`, they are simply never read —
 * silently ignored, with no effect on the outcome; `gatherFilesystemEvidence`
 * always runs with its own real, hardcoded default transports.
 * @param {object} params
 * @param {'TARGET_WORKTREE'|'LOCAL_FILESYSTEM'|'HISTORICAL'} params.sourceClass
 * @param {string} params.rootDir
 * @param {string} params.relPath
 * @param {string} params.expectedRootCommit
 * @param {string} params.evidenceId
 * @param {boolean} params.supportsClaim strict boolean, required
 * @param {string[]} [params.derivedFromEvidenceIds]
 * @param {unknown} [params.timestamp]
 * @param {string} [params.verificationMethod]
 * @returns {{evidence: object|null, error: string|null}}
 */
export function attestFilesystemEvidence(params) {
  if (!isPlainParamsObject(params)) {
    return { evidence: null, error: 'INVALID_OBSERVATION' };
  }
  const {
    sourceClass, rootDir, relPath, expectedRootCommit, evidenceId, supportsClaim,
    derivedFromEvidenceIds, timestamp, verificationMethod,
  } = params;

  const mapping = FILESYSTEM_ATTESTABLE_CLASSES[sourceClass];
  if (!mapping) {
    return { evidence: null, error: 'UNSUPPORTED_SOURCE_CLASS' };
  }
  if (!isValidEvidenceId(evidenceId)) {
    return { evidence: null, error: 'INVALID_EVIDENCE_ID' };
  }
  const supportsClaimResult = normalizeSupportsClaim(supportsClaim);
  if (!supportsClaimResult.valid) {
    return { evidence: null, error: 'INVALID_SUPPORTS_CLAIM' };
  }

  // No spawnSyncFn/existsSyncFn/readFileSyncFn/realpathSyncFn forwarded —
  // gatherFilesystemEvidence falls through to its own real, hardcoded
  // default transports (source-of-truth.mjs, unmodified).
  const gathered = gatherFilesystemEvidence({
    sourceClass: mapping.sotClass,
    rootDir,
    relPath,
    expectedRootCommit,
  });
  if (gathered.resolutionStatus !== 'OK') {
    return { evidence: null, error: `SOURCE_OF_TRUTH_UNVERIFIED:${gathered.resolutionStatus}` };
  }

  const contentHash = createHash('sha256').update(gathered.content, 'utf8').digest('hex');
  const evidence = finalizeAttestedEvidence({
    evidenceId,
    sourceClass,
    strength: mapping.strength,
    // Improvement 3/5: `readFileSync` on a real local path is content
    // inspection, never execution.
    verificationLevel: 'STATIC',
    sourceFingerprint: buildFilesystemFingerprint({
      canonicalRepositoryIdentity: typeof expectedRootCommit === 'string' ? expectedRootCommit : '',
      canonicalPath: relPath,
      contentHash,
    }),
    supportsClaim: supportsClaimResult.value,
    derivedFromEvidenceIds,
    timestamp,
    verificationMethod: typeof verificationMethod === 'string' ? verificationMethod : 'source-of-truth:gatherFilesystemEvidence',
  });
  return { evidence, error: null };
}

// ---------------------------------------------------------------------------
// Improvement 3/5 — the ONLY way to produce LOCAL_RUNTIME trusted evidence.
// Deliberately narrow: the only thing this function can ever execute is
// `node --test <relPath>`, inside a `rootDir` that must first pass
// Improvement 1's real repository-identity + path-safety + tracked-file
// gates (via `gatherFilesystemEvidence`, unmodified) — never a
// caller-suppliable command, executable, or argument list of any kind. This
// keeps the new local-execution surface exactly as narrow as Improvement
// 1/2's git-read-only surface: real, but not a generic command runner.
// ---------------------------------------------------------------------------

/**
 * @param {object} params
 * @param {string} params.rootDir
 * @param {string} params.relPath repo-relative path to a real, tracked test file — the ONLY thing this function ever executes is `node --test <relPath>`
 * @param {string} params.expectedRootCommit
 * @param {string} params.evidenceId
 * @param {boolean} params.supportsClaim strict boolean, required
 * @param {string[]} [params.derivedFromEvidenceIds]
 * @param {unknown} [params.timestamp]
 * @param {string} [params.verificationMethod]
 * @returns {{evidence: object|null, error: string|null}}
 */
export function attestLocalRuntimeEvidence(params) {
  if (!isPlainParamsObject(params)) {
    return { evidence: null, error: 'INVALID_OBSERVATION' };
  }
  const {
    rootDir, relPath, expectedRootCommit, evidenceId, supportsClaim,
    derivedFromEvidenceIds, timestamp, verificationMethod,
  } = params;

  if (!isValidEvidenceId(evidenceId)) {
    return { evidence: null, error: 'INVALID_EVIDENCE_ID' };
  }
  const supportsClaimResult = normalizeSupportsClaim(supportsClaim);
  if (!supportsClaimResult.valid) {
    return { evidence: null, error: 'INVALID_SUPPORTS_CLAIM' };
  }

  // Reuse Improvement 1's real identity + path-safety + tracked-file gates
  // to confirm `relPath` genuinely, safely exists in `rootDir` BEFORE ever
  // spawning a process — a foreign repository, a path-traversal attempt, or
  // an untracked path all fail exactly as Improvement 1's own gates dictate,
  // and nothing is ever executed against an unverified path.
  const gathered = gatherFilesystemEvidence({ sourceClass: 'LOCAL_ROOT', rootDir, relPath, expectedRootCommit });
  if (gathered.resolutionStatus !== 'OK') {
    return { evidence: null, error: `SOURCE_OF_TRUTH_UNVERIFIED:${gathered.resolutionStatus}` };
  }

  // The ONLY command this function can ever run. No caller-suppliable
  // command/executable/args of any kind.
  //
  // `NODE_TEST_CONTEXT`/`NODE_TEST_WORKER_ID` (and any other `NODE_TEST_*`
  // variable) are stripped from the child's environment — live-discovered
  // during this revision's own test suite: when THIS function's caller is
  // itself already running under `node --test` (exactly what happens when
  // evidence-policy.test.mjs exercises this attestor), `spawnSync`'s
  // default env inheritance passes `NODE_TEST_CONTEXT=child-v8` straight
  // through, and the spawned `node --test` then reports itself as a
  // coordinated CHILD of the outer run — exiting 0 regardless of whether
  // its own tests passed. Left unfixed, that would make this attestor
  // silently report SUCCESS for a real, observed FAILURE whenever it is
  // invoked from within a `node --test` process — exactly the class of
  // ambient-environment corruption this project has repeatedly had to
  // close (see the POST-R5/IMP2-GITGLOBAL-001 header comment above).
  const childEnv = { ...process.env };
  for (const key of Object.keys(childEnv)) {
    if (key.startsWith('NODE_TEST_')) delete childEnv[key];
  }
  const observedAt = new Date().toISOString();
  const result = spawnSync('node', ['--test', relPath], { cwd: rootDir, encoding: 'utf8', shell: false, timeout: 120000, env: childEnv });
  const timedOut = result.signal !== null && result.signal !== undefined;
  if (!result || timedOut || typeof result.status !== 'number') {
    return { evidence: null, error: 'LOCAL_RUNTIME_EXECUTION_UNRESOLVED' };
  }

  const evidence = finalizeAttestedEvidence({
    evidenceId,
    sourceClass: 'TEST_RUNTIME',
    // A real execution genuinely happened either way — DIRECT reflects
    // confidence in the OBSERVATION, not the polarity of its outcome
    // (whether the test passed or failed is carried in `observedExitCode`;
    // `supportsClaim` is the caller's own semantic judgment of what that
    // outcome means for the specific claim under evaluation, exactly as
    // for the other two attestors).
    strength: 'DIRECT',
    verificationLevel: 'LOCAL_RUNTIME',
    sourceFingerprint: buildRuntimeFingerprint({
      executionId: `${rootDir}::${relPath}::${observedAt}`,
      resource: relPath,
      observationType: 'node-test-exit-code',
    }),
    supportsClaim: supportsClaimResult.value,
    derivedFromEvidenceIds,
    timestamp: timestamp ?? observedAt,
    verificationMethod: typeof verificationMethod === 'string' ? verificationMethod : 'evidence-policy:attestLocalRuntimeEvidence',
    observedAt,
    observedExitCode: result.status,
  });
  return { evidence, error: null };
}

// ---------------------------------------------------------------------------
// NIGHT_REMEDIATION_1 (IMP3-TARGET-BINDING-001, CRITICAL) closes a finding
// an independent audit reproduced against the original Improvement 3
// design: `attestRemoteRuntimeEvidence` performed a REAL HTTPS GET, but
// `environment`/`targetIdentity` were caller-supplied DATA treated as if
// they were verified CONCLUSIONS — the real fetch only ever proved "this
// URL responded"; it never proved "this URL IS the claimed environment/
// target." Live reproduction: the SAME URL was successfully attested as
// BOTH `Production` and `Development` in two separate calls, and an
// arbitrary public URL (unrelated to any real Rouvy service) was attested
// `environment: 'Production'` and used to CONFIRM a "Production Cloud Run
// is healthy" claim. This is exactly the class of defect Improvement 2's
// R1->R5 saga repeatedly closed for remote-main (caller supplies the
// CONCLUSION, not just the MATERIAL) — reintroduced here because
// REMOTE_RUNTIME, unlike remote-main, has no single canonical target to
// hardcode.
//
// Fixed the same way R5 fixed remote-main: a FIXED, code-defined,
// never-caller-supplied registry (`KNOWN_REMOTE_RUNTIME_TARGETS`) is the
// only source of `url`/`environment`/`sourceClass` for a given target. A
// caller selects WHICH known target to check (`targetKey` — a legitimate,
// non-privileged choice among a FIXED set), never WHAT that target's
// url/environment/identity actually are; `targetIdentity` on the resulting
// evidence is the registry key itself, never a caller-supplied string.
// This project has no real Development/Staging/Production Cloud Run URLs
// known to this module — inventing them would be fabricating verification
// that doesn't exist (this project's own explicit, repeated principle).
// The registry below therefore holds only clearly-labeled, non-Rouvy
// reference entries used to exercise this mechanism in tests; real target
// entries must be added here by whoever configures this module against
// actual deployed infrastructure. Until an entry exists for a given
// target, that target simply cannot be attested — the safe state.
// ---------------------------------------------------------------------------

const REMOTE_RUNTIME_ATTESTABLE_CLASSES = Object.freeze(['APPLICATION_RUNTIME', 'CLOUD_RUNTIME']);

const KNOWN_REMOTE_RUNTIME_TARGETS = Object.freeze({
  // Reference/test-only entries — real, stable public endpoints used to
  // exercise the REMOTE_RUNTIME mechanism itself. NOT Rouvy project
  // targets. Add real entries here (never accept them from a caller).
  'reference-public-endpoint-development': Object.freeze({ url: 'https://github.com', environment: 'Development', sourceClass: 'CLOUD_RUNTIME' }),
  'reference-public-endpoint-production': Object.freeze({ url: 'https://github.com', environment: 'Production', sourceClass: 'CLOUD_RUNTIME' }),
  // A deliberately unreachable domain, for exercising the real
  // REMOTE_RUNTIME_UNREACHABLE fail-closed path — never resolves, by
  // construction (`.invalid` is reserved by RFC 2606 to never be
  // registered).
  'reference-unreachable-endpoint': Object.freeze({ url: 'https://this-domain-genuinely-does-not-exist-korixa-imp3-test.invalid', environment: 'Production', sourceClass: 'CLOUD_RUNTIME' }),
});

/**
 * @param {object} params
 * @param {string} params.targetKey must be a key in the fixed KNOWN_REMOTE_RUNTIME_TARGETS registry — url/environment/sourceClass are never caller-supplied
 * @param {number[]} [params.expectedStatusCodes] defaults to any 2xx
 * @param {string} params.evidenceId
 * @param {boolean} params.supportsClaim strict boolean, required
 * @param {string[]} [params.derivedFromEvidenceIds]
 * @param {unknown} [params.timestamp]
 * @param {string} [params.verificationMethod]
 * @returns {Promise<{evidence: object|null, error: string|null}>}
 */
export async function attestRemoteRuntimeEvidence(params) {
  if (!isPlainParamsObject(params)) {
    return { evidence: null, error: 'INVALID_OBSERVATION' };
  }
  const {
    targetKey, expectedStatusCodes,
    evidenceId, supportsClaim, derivedFromEvidenceIds, timestamp, verificationMethod,
  } = params;

  const target = typeof targetKey === 'string' ? KNOWN_REMOTE_RUNTIME_TARGETS[targetKey] : undefined;
  if (!target) {
    return { evidence: null, error: 'UNKNOWN_REMOTE_RUNTIME_TARGET' };
  }
  if (!REMOTE_RUNTIME_ATTESTABLE_CLASSES.includes(target.sourceClass)) {
    return { evidence: null, error: 'UNSUPPORTED_SOURCE_CLASS' };
  }
  if (!isValidEvidenceId(evidenceId)) {
    return { evidence: null, error: 'INVALID_EVIDENCE_ID' };
  }
  const supportsClaimResult = normalizeSupportsClaim(supportsClaim);
  if (!supportsClaimResult.valid) {
    return { evidence: null, error: 'INVALID_SUPPORTS_CLAIM' };
  }

  // From here on, url/environment/sourceClass/targetIdentity all come from
  // the FIXED registry entry — never from `params`.
  const { url, environment, sourceClass } = target;
  const observedAt = new Date().toISOString();
  let response;
  try {
    response = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10000) });
  } catch {
    return { evidence: null, error: 'REMOTE_RUNTIME_UNREACHABLE' };
  }
  const observedStatusCode = response.status;

  const evidence = finalizeAttestedEvidence({
    evidenceId,
    sourceClass,
    strength: 'DIRECT',
    verificationLevel: 'REMOTE_RUNTIME',
    sourceFingerprint: buildRuntimeFingerprint({
      executionId: `${targetKey}::${observedAt}`,
      resource: targetKey,
      observationType: 'https-get-status',
    }),
    supportsClaim: supportsClaimResult.value,
    derivedFromEvidenceIds,
    timestamp: timestamp ?? observedAt,
    verificationMethod: typeof verificationMethod === 'string' ? verificationMethod : 'evidence-policy:attestRemoteRuntimeEvidence',
    environment,
    targetIdentity: targetKey,
    observedStatusCode,
    observedAt,
  });
  return { evidence, error: null };
}

// ---------------------------------------------------------------------------
// Public API — evaluateClaim. Pure with respect to the trust decision: it
// checks `TRUSTED_EVIDENCE_REGISTRY` by OBJECT IDENTITY against each raw
// evidence element (before normalization ever runs) — copying every
// property of a trusted object (even via Reflect/spread/Object.create/JSON
// round-trip/structuredClone) produces a NEW object reference that is
// simply absent from the registry.
// ---------------------------------------------------------------------------

/**
 * @param {object} params
 * @param {string} params.claimId
 * @param {string} params.title
 * @param {'P0'|'P1'|'P2'|'P3'} params.severity
 * @param {object[]} params.evidence
 * @param {boolean} [params.singleSourceExceptionRequested]
 * @param {string} [params.singleSourceExceptionReason]
 * @returns {object} ClaimEvaluation
 */
// Improvement 3/5: normalizes `evaluateClaim`'s optional
// `requiredVerificationLevels` filter. Absent/null -> no filter (`null`).
// Present but malformed (not an array, or an array whose members are not
// all recognized VERIFICATION_LEVELS) -> an empty array, which structurally
// matches NOTHING — a malformed requirement must never silently relax into
// "no requirement" (fail closed, never fail open on garbage config).
function normalizeRequiredVerificationLevels(raw) {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) return [];
  return raw.filter((level) => VERIFICATION_LEVELS.includes(level));
}

// Same fail-closed shape for `requiredEnvironment`: absent/null -> no
// filter; present but not a real ENVIRONMENTS member -> a sentinel that can
// never match any real evidence's `.environment`.
const INVALID_REQUIRED_ENVIRONMENT_SENTINEL = '__INVALID_REQUIRED_ENVIRONMENT__';
function normalizeRequiredEnvironment(raw) {
  if (raw === undefined || raw === null) return null;
  return ENVIRONMENTS.includes(raw) ? raw : INVALID_REQUIRED_ENVIRONMENT_SENTINEL;
}

// NIGHT_REMEDIATION_1 (IMP3-STALENESS-001, MEDIUM), then hardened by
// IMPROVEMENT_3_STALENESS_002_REMEDIATION (see that header comment above):
// a genuinely real REMOTE_RUNTIME observation from arbitrarily long ago
// must not be reusable, unchanged, to "confirm" a claim about the CURRENT
// state. `trustedNowMs` here is NEVER caller-supplied `params` data — it is
// always either `null` (no staleness check requested) or a real
// `Date.now()` reading taken by the public `evaluateClaim` boundary, passed
// down as an explicit argument. This function itself stays pure: it makes
// no clock call of its own, it only validates/uses the value it was given.
// Absent `requiredMaxAgeMs`, no staleness check runs (existing callers are
// unaffected); a malformed `requiredMaxAgeMs` (negative, NaN, Infinity,
// non-number) fails closed (treated as if every observation were
// infinitely stale) rather than silently skipping the requirement the
// caller explicitly asked for.
function normalizeStalenessCheck(rawMaxAgeMs, trustedNowMs) {
  if (rawMaxAgeMs === undefined || rawMaxAgeMs === null) return null;
  const maxAgeMs = typeof rawMaxAgeMs === 'number' && Number.isFinite(rawMaxAgeMs) && rawMaxAgeMs >= 0 ? rawMaxAgeMs : -1;
  const nowMs = typeof trustedNowMs === 'number' && Number.isFinite(trustedNowMs) ? trustedNowMs : NaN;
  // maxAgeMs<0 (malformed) or nowMs NaN (no valid trusted clock reading was
  // taken) both fail closed via an unsatisfiable check (nowMs NaN makes
  // every comparison below false, matching "requirement present but cannot
  // be verified").
  return { maxAgeMs, nowMs };
}

function isEvidenceFreshEnough(e, stalenessCheck) {
  if (stalenessCheck === null) return true;
  if (stalenessCheck.maxAgeMs < 0 || Number.isNaN(stalenessCheck.nowMs)) return false;
  if (typeof e.observedAt !== 'string') return false;
  const observedAtMs = Date.parse(e.observedAt);
  if (Number.isNaN(observedAtMs)) return false;
  const ageMs = stalenessCheck.nowMs - observedAtMs;
  return ageMs >= 0 && ageMs <= stalenessCheck.maxAgeMs;
}

// The pure decision core (Improvement 3/5 extended). Never exported, never
// reads the clock/filesystem/network/`process` itself — `trustedNowMs` and
// `rawRequiredMaxAgeMs` are always explicit arguments supplied by the
// public `evaluateClaim` boundary below, never (re-)derived from `params`.
// This is what INTERNAL_POLICY_CORE_PURE means in this revision's own task
// framing: the actual evidence-evaluation logic is exactly as deterministic
// and side-effect-free as `evaluateClaim` was before IMPROVEMENT_3_
// STALENESS_002_REMEDIATION; only the ONE real wall-clock read has moved to
// the boundary that owns it.
//
// IMPROVEMENT_3_STALENESS_003_REMEDIATION (this revision): `requiredMaxAgeMs`
// is deliberately NOT destructured from `params`/`safeParams` here anymore
// — see the header comment on `evaluateClaim` below for why. This function
// must never read that field from the live, caller-controlled `params`
// object a second time; it only ever sees the ALREADY-SNAPSHOTTED value the
// boundary read exactly once and hands in as `rawRequiredMaxAgeMs`.
function evaluateClaimCore(params, trustedNowMs, rawRequiredMaxAgeMs) {
  const safeParams = isPlainParamsObject(params) ? params : {};
  const {
    claimId, title, severity, evidence, singleSourceExceptionRequested = false, singleSourceExceptionReason = null,
    requiredVerificationLevels: rawRequiredVerificationLevels, requiredEnvironment: rawRequiredEnvironment,
  } = safeParams;
  const requiredVerificationLevels = normalizeRequiredVerificationLevels(rawRequiredVerificationLevels);
  const requiredEnvironment = normalizeRequiredEnvironment(rawRequiredEnvironment);
  const stalenessCheck = normalizeStalenessCheck(rawRequiredMaxAgeMs, trustedNowMs);

  const baseResult = {
    claimId: typeof claimId === 'string' ? claimId : null,
    title: typeof title === 'string' ? title : null,
    severity: SEVERITIES.includes(severity) ? severity : null,
  };

  if (!SEVERITIES.includes(severity)) {
    return {
      ...baseResult,
      evidence: [],
      effectiveEvidence: [],
      effectiveEvidenceCount: 0,
      confidence: 'UNVERIFIED',
      conflicts: [],
      decision: 'UNVERIFIED',
      decisionReason: 'invalid_severity',
      singleSourceExceptionUsed: false,
      singleSourceExceptionReason: null,
    };
  }

  const rawList = Array.isArray(evidence) ? evidence : [];
  const normalized = rawList.map((raw, i) => normalizeEvidence(raw, i, TRUSTED_EVIDENCE_REGISTRY.has(raw)));

  const duplicateCheck = detectDuplicateEvidenceIds(normalized);
  if (duplicateCheck.hasDuplicates) {
    return {
      ...baseResult,
      evidence: normalized,
      effectiveEvidence: [],
      effectiveEvidenceCount: 0,
      confidence: 'UNVERIFIED',
      conflicts: [],
      decision: 'HOLD_DUPLICATE_EVIDENCE_ID',
      decisionReason: `duplicate_evidence_id:${duplicateCheck.duplicateIds.join(',')}`,
      singleSourceExceptionUsed: false,
      singleSourceExceptionReason: null,
    };
  }

  const cycleCheck = detectDerivationCycle(normalized);
  if (cycleCheck.hasCycle) {
    return {
      ...baseResult,
      evidence: normalized,
      effectiveEvidence: [],
      effectiveEvidenceCount: 0,
      confidence: 'UNVERIFIED',
      conflicts: [],
      decision: 'HOLD_INVALID_EVIDENCE_GRAPH',
      decisionReason: `derivation_cycle:${cycleCheck.cycleIds.join('->')}`,
      singleSourceExceptionUsed: false,
      singleSourceExceptionReason: null,
    };
  }

  const { unresolvedConflicts, hierarchyResolutions, hierarchyLosers } = analyzeConflicts(normalized);

  const requiresTrust = severity === 'P0' || severity === 'P1';
  const eligibleForCounting = normalized.filter((e) =>
    e.supportsClaim === true
    && !e.supportsClaimInvalid
    && !hierarchyLosers.has(e.evidenceId)
    && (!requiresTrust || e.isTrusted));

  // Improvement 3/5: applied AFTER the existing trust/supportsClaim/
  // hierarchy filter, BEFORE clustering — a SEPARATE axis from trust. This
  // is what makes STATIC/LOCAL_RUNTIME structurally unable to certify a
  // claim that requires REMOTE_RUNTIME (or a specific environment): the
  // evidence can be perfectly trusted and still not be the RIGHT KIND of
  // observation. Distinguished explicitly from "no evidence at all" —
  // evidence existed and was trusted, it just wasn't observed the way this
  // claim required — via its own decision, never silently falling through
  // to the ordinary strength-based thresholds below.
  // NIGHT_REMEDIATION_1 (IMP3-STALENESS-001): `stalenessCheck` joins the
  // same filter — an evidence entry that is the right verificationLevel/
  // environment but too OLD relative to the caller-supplied `now` is
  // treated identically to one of the wrong kind: excluded here, never
  // silently allowed to certify a "right now" claim.
  const verificationLevelFilterActive = requiredVerificationLevels !== null || requiredEnvironment !== null || stalenessCheck !== null;
  const levelFilteredForCounting = verificationLevelFilterActive
    ? eligibleForCounting.filter((e) =>
      (requiredVerificationLevels === null || requiredVerificationLevels.includes(e.verificationLevel))
      && (requiredEnvironment === null || e.environment === requiredEnvironment)
      && isEvidenceFreshEnough(e, stalenessCheck))
    : eligibleForCounting;

  if (verificationLevelFilterActive && eligibleForCounting.length > 0 && levelFilteredForCounting.length === 0) {
    return {
      ...baseResult,
      evidence: normalized,
      effectiveEvidence: [],
      effectiveEvidenceCount: 0,
      confidence: 'UNVERIFIED',
      conflicts: [...unresolvedConflicts, ...hierarchyResolutions],
      decision: 'HOLD_INSUFFICIENT_VERIFICATION_LEVEL',
      decisionReason: 'trusted_supporting_evidence_present_but_wrong_verification_level_or_environment_or_too_stale',
      singleSourceExceptionUsed: false,
      singleSourceExceptionReason: null,
    };
  }

  const clusters = clusterEligibleEvidence(levelFilteredForCounting);
  const effectiveClusters = clusters.map((cluster) => ({
    evidenceIds: cluster.map((e) => e.evidenceId),
    sourceClasses: [...new Set(cluster.map((e) => e.sourceClass))],
    maxStrength: clusterMaxStrength(cluster),
  }));

  const outcome = decideOutcome({
    severity,
    effectiveClusters,
    unresolvedConflicts,
    totalEvidenceCount: normalized.length,
    singleSourceExceptionRequested,
    singleSourceExceptionReason,
  });

  return {
    ...baseResult,
    evidence: normalized,
    effectiveEvidence: effectiveClusters,
    effectiveEvidenceCount: effectiveClusters.length,
    confidence: outcome.confidence,
    conflicts: [...unresolvedConflicts, ...hierarchyResolutions],
    decision: outcome.decision,
    decisionReason: outcome.decisionReason,
    singleSourceExceptionUsed: outcome.singleSourceExceptionUsed,
    singleSourceExceptionReason: outcome.singleSourceExceptionUsed ? singleSourceExceptionReason : null,
  };
}

// IMPROVEMENT_3_STALENESS_002_REMEDIATION: the PUBLIC boundary. The only
// place in this module allowed to read the real system clock for a
// security purpose. Deliberately NOT pure — see this revision's header
// comment for why that tradeoff was made deliberately, in favor of a REAL
// guarantee that `requiredMaxAgeMs` cannot be defeated by a caller
// asserting a false `now`. `params` is never read for a clock value under
// ANY key name — `now`, `currentTime`, `timestamp`, `clock`, `wallClock`,
// `dateNow`, `observedNow`, `trustedNow`, `options.now`, a nested object, a
// spread property, or a prototype-inherited property of any of those names
// all have zero effect on the outcome, because none of them is ever read;
// the trusted reading always comes from this function's own direct system
// clock call below, taken exactly once, only when `requiredMaxAgeMs` is
// actually present.
//
// IMPROVEMENT_3_STALENESS_003_REMEDIATION (this revision) closes
// IMP3-STALENESS-003 (MEDIUM-HIGH), independently discovered during
// IMPROVEMENT_3_STALENESS_002_REMEDIATION's own closure audit:
// `requiredMaxAgeMs` itself — not `now` — was the live, caller-controlled
// TOCTOU surface. The R002 design read `params.requiredMaxAgeMs` HERE (to
// decide whether a real clock reading was needed) and then let
// `evaluateClaimCore` read the SAME field a second time, from the SAME
// live `params` reference, to get the value actually used for the
// comparison. A `params` object with a getter (or a `Proxy`) for
// `requiredMaxAgeMs` could answer the first read with a real, small number
// (making this boundary spend its one trusted-clock read) and the second
// read with `undefined` (making `evaluateClaimCore` see NO staleness
// requirement at all) — silently discarding the entire freshness filter
// for a genuinely, really stale observation. Live-reproduced: a real
// REMOTE_RUNTIME observation, 755ms genuinely old, evaluated against a
// 50ms window, reached CONFIRMED_P1.
//
// Fixed with SECURITY_RELEVANT_INPUTS_MUST_BE_SNAPSHOTTED_ONCE: this
// function reads `params.requiredMaxAgeMs` into a local binding EXACTLY
// ONCE, then passes that already-resolved value into `evaluateClaimCore`
// as an explicit argument — `evaluateClaimCore` no longer destructures
// `requiredMaxAgeMs` from `params`/`safeParams` at all (see that function's
// own updated header comment), so there is no second read for a getter/
// `Proxy` to answer differently. `LIVE_CALLER_OBJECT_NOT_REUSED_BY_CORE`
// applies narrowly here, to exactly the one field that was ever read twice
// — `requiredVerificationLevels`/`requiredEnvironment`/`evidence`/
// `severity`/etc. were each already read only ONCE (inside
// `evaluateClaimCore`'s own single destructuring), so they carry no
// equivalent TOCTOU surface and are deliberately left as-is rather than
// rebuilding this boundary into a general-purpose snapshot mechanism that
// nothing here actually needs.
export function evaluateClaim(params) {
  const safeParams = isPlainParamsObject(params) ? params : {};
  // Read exactly once. This binding, not `params`, is the only thing that
  // ever determines both whether a clock reading is taken AND what
  // staleness limit is applied — a getter/Proxy has exactly one
  // opportunity to answer, and whatever it answers here is what governs,
  // for the rest of this call, with no possibility of re-invocation.
  const rawRequiredMaxAgeMs = safeParams.requiredMaxAgeMs;
  const usesStalenessCheck = rawRequiredMaxAgeMs !== undefined && rawRequiredMaxAgeMs !== null;
  const trustedNowMs = usesStalenessCheck ? Date.now() : null;
  return evaluateClaimCore(params, trustedNowMs, rawRequiredMaxAgeMs);
}
