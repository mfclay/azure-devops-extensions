/**
 * `@bicep-whatif/core`
 *
 * Turns an Azure Deployment Stacks what-if payload into rows a UI can rank.
 * Deliberately UI-agnostic: no React, no Azure DevOps SDK, no styling. Six UX
 * decisions about the grid are still open and this package has to survive all of
 * them.
 *
 * Two rules run through everything here:
 *
 *   1. Parse defensively. An unknown value renders as itself and is reported in
 *      `warnings`; nothing throws.
 *   2. Absence of data never renders as absence of change. Anything that could not
 *      be evaluated ranks `unevaluated`, above `noChange`, so a default filter
 *      cannot hide it.
 */
export {
  normalizeStackWhatIf,
  normalizeEstate,
  flattenPropertyChanges,
  diagnosticsFor,
  needsAttention,
} from './normalize.js';

export {
  severityOf,
  compareBySeverityDesc,
  isManagementLost,
  isDenyWeakened,
  SEVERITIES,
  SEVERITY_RANK,
  SEVERITY_GLYPH,
  SEVERITY_TONE,
  type Severity,
  type SeverityInput,
  type SeverityAxis,
  type SeverityReason,
  type SeverityReasonCode,
  type SeverityVerdict,
} from './severity.js';

export {
  parseResourceChangeType,
  parsePropertyChangeType,
  parseManagementStatus,
  parseDenyStatus,
  denyStrength,
  RESOURCE_CHANGE_TYPES,
  PROPERTY_CHANGE_TYPES,
  MANAGEMENT_STATUSES,
  DENY_STATUSES,
  type Parsed,
  type ResourceChangeType,
  type PropertyChangeType,
  type ManagementStatus,
  type DenyStatus,
} from './enums.js';

export type {
  DenySettings,
  NormalizedEstate,
  NormalizedStackWhatIf,
  ParseWarning,
  PropertyChange,
  ResourceRow,
  StatusTransition,
  WhatIfDiagnostic,
} from './model.js';

export type {
  RawStackWhatIfResult,
  RawStackWhatIfProperties,
  RawResourceChange,
  RawResourceConfigurationChanges,
  RawPropertyDelta,
  RawStatusChange,
  RawDenySettings,
} from './raw.js';
