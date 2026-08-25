// Korixa — task-orchestrator.mjs public entry point.
//
// P1-E REMEDIATION (T-F1.2 external re-audit round 4, HOLD): this file used
// to be a "hardened facade" wrapping task-orchestrator-core.mjs's
// recordAuditResult/recordValidationResult/recordFinalPrMetadataVerification/
// requestHumanGate with the workflow-certification checks added for P1-1/
// P1-2 -- while task-orchestrator-core.mjs (independently importable, and
// imported directly by this very file) kept the original, unhardened
// versions of those same four functions. A caller that imported the core
// directly, bypassing this facade, reached an authoritative READY_FOR_C /
// READY_FOR_HUMAN transition for a genuinely workflow-changing task with
// zero workflow proof -- reproduced mechanically. "Everyone must import the
// facade, never the core" is a convention, not a security boundary.
//
// The fix consolidates the workflow-certification enforcement DIRECTLY into
// task-orchestrator-core.mjs's own recordAuditResult/recordValidationResult/
// recordFinalPrMetadataVerification/requestHumanGate (and its own exported
// evaluatePersistedWorkflowCertification) -- see that file's header comment
// and each function's own comment for the enforcement itself. There is no
// longer a second, weaker implementation to bypass by importing around this
// file: this module is now a pure re-export, kept only as the historical
// public entry point so existing imports of './task-orchestrator.mjs'
// continue to resolve to the one, single, authoritative implementation.

export * from './task-orchestrator-core.mjs';
