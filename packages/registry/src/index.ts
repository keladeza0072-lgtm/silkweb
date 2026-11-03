export { createBookingSchema, SCHEMA_STATEMENTS, type AppointmentRow } from './schema.js';
export {
  parseBookingInput,
  isSlotAligned,
  BookingValidationError,
  BOOKING_VALIDATION_ERROR_CODE,
  type BookingInput,
} from './validation.js';
export {
  createBooking,
  getBooking,
  cancelBooking,
  listActiveBookings,
  SlotConflictError,
  BookingReferenceError,
  BookingNotFoundError,
  BookingStateError,
  SLOT_CONFLICT_CODE,
  BOOKING_REFERENCE_ERROR_CODE,
  BOOKING_NOT_FOUND_CODE,
  BOOKING_STATE_ERROR_CODE,
} from './slotGuard.js';
export {
  manifestSchema,
  type RegistryManifest,
  type ManifestDependency,
} from './manifest.js';
export {
  loadRegistry,
  filterRegistry,
  RegistryLoadError,
  type RegistryQuery,
} from './loader.js';
export {
  LOCKFILE_REL,
  PACKAGE_JSON_REL,
  TSCONFIG_REL,
  COMPONENT_EXTRA_SOURCES,
  FingerprintError,
  assertSafeRepoRelPath,
  resolveRepoPath,
  sha256Hex,
  canonicalJson,
  indexManifests,
  resolveClosure,
  testFilesFor,
  extraSourcesFor,
  localSourceImports,
  sourceFilesForComponent,
  closureTestFiles,
  computeArtifactFingerprint,
  type FingerprintSections,
  type ArtifactFingerprint,
  type ManifestIndex,
} from './fingerprint.js';
export {
  EVIDENCE_SCHEMA_VERSION,
  evidenceSchema,
  EvidenceError,
  evidenceFileName,
  readEvidenceFile,
  resolveEvidencePath,
  writeEvidenceFile,
  type VerificationEvidence,
} from './evidence.js';
export {
  TEST_COMMAND_ALLOWLIST,
  BUILD_OUTPUTS,
  COMPONENT_ALLOWED_COMMANDS,
  allowedCommandsFor,
  RunnerError,
  runVerification,
  type AllowedBuild,
  type AllowedTestCommand,
  type RunVerificationOptions,
  type VerificationRun,
} from './runner.js';
export {
  validateComponent,
  selectVerifiedManifests,
  type ValidationOptions,
  type ComponentValidation,
  type VerifiedSelection,
} from './validate.js';
