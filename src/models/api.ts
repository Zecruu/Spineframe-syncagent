// SpineFrame API Request/Response Types

export interface HeartbeatRequest {
  agentVersion: string;
  hostname: string;
  osUser: string;
  watchFolder: string;
  pendingFiles: number;
  lastSyncAt: string | null;
}

export interface HeartbeatResponse {
  ok: boolean;
  serverTime: string;
  clinicCode: string;
  message: string;
}

export interface PatientUpsertRequest {
  externalSystem: string;
  externalId: string;
  firstName: string;
  middleName: string;
  lastName: string;
  dob: string;
  gender: string;
  phone: string;
  email: string;
  address: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    zip: string;
  };
  identifiers: {
    mrn: string;
    ssnLast4: string;
  };
  insurance: Array<{
    payerId: string;
    payerName: string;
    memberId: string;
    groupId: string;
    relationship: string;
    planType: string;
  }>;
}

export interface PatientUpsertResponse {
  ok: boolean;
  patientId: string;
  created: boolean;
  message: string;
}

export interface EncounterChargeRequest {
  externalSystem: string;
  patientExternalId: string;
  visitExternalId: string;
  visitDate: string;
  visitTime: string;
  providerExternalId: string;
  facilityExternalId: string;
  icdCodes: string[];
  cptLines: Array<{
    code: string;
    modifiers: string[];
    units: number;
    amount: number;
    description: string;
  }>;
  notes: string;
}

export interface EncounterChargeResponse {
  ok: boolean;
  encounterId: string;
  created: boolean;
  message: string;
}

export interface NoteRequest {
  externalSystem: string;
  patientExternalId: string;
  visitExternalId: string;
  noteType: string;
  content: string;
}

export interface NoteResponse {
  ok: boolean;
  patientId: string;
  visitId: string;
  message: string;
}

export interface StatusResponse {
  ok: boolean;
  status: {
    enabled: boolean;
    mode: string;
    agentLastHeartbeat: string;
    stats: {
      totalMessagesReceived: number;
      totalErrors: number;
    };
  };
}

export interface ApiErrorResponse {
  ok: false;
  error: string;
  code: string;
  details?: string;
}

// Export (SpineFrame → ProClaim) Types

export interface ExportClinicInfo {
  code: string;
  name: string;
  npi: string;
  taxId: string;
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
  emrLinkType: string;
  emrName: string;
}

export interface ExportPatientInfo {
  id: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  dob: string;
  sex: string;
  phone?: string;
  email?: string;
  address?: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
  };
  recordNumber?: string;
  proclaimPatientRecord?: string;
  proclaimInternalControl?: string;
  insurance?: Array<{
    provider: string;
    memberId: string;
    groupNumber?: string;
  }>;
}

export interface ExportPayerInfo {
  name: string;
  payerId: string;
  coverId?: string;           // Cover ID (raw value)
  memberId?: string;
  policyNumber?: string;      // SpineFrame calls memberId "policyNumber"
  groupNumber?: string;
  relationshipCode?: string;  // Pre-mapped relationship code (e.g., "18" for self)

  // Pre-formatted IN1 field values from SpineFrame - USE THESE DIRECTLY!
  in1_2?: string;   // Insurance Plan ID (e.g., "6605^88600") - copy as-is
  in1_3?: string;   // Insurance Company ID (e.g., "6605^88600") - copy as-is
  in1_17?: string;  // Relationship code (e.g., "18") - copy as-is
  in1_36?: string;  // Policy Number / Member ID - copy as-is
}

export interface ExportBillingCode {
  code: string;
  description: string;
  quantity: number;
  chargeAmount: number;
  modifiers: string[];
}

export interface ExportRenderingProvider {
  name: string;
  npi: string;
  taxId?: string;
}

export interface ExportBillingProvider {
  name: string;
  npi: string;
  taxId?: string;
  address?: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
}

export interface ExportClaim {
  claimId: string;
  dateOfService: string;
  createdAt: string;
  patient: ExportPatientInfo;
  payer: ExportPayerInfo;
  billingCodes: ExportBillingCode[];
  diagnosisCodes: string[];
  totalChargeAmount: number;
  copay?: number;
  renderingProvider: ExportRenderingProvider;
  billingProvider: ExportBillingProvider;
  placeOfService: string;
}

export interface PendingExportsResponse {
  ok: boolean;
  count: number;
  fetchId: string;        // NEW: Must save this for confirmation!
  format: string;
  clinic: ExportClinicInfo;
  claims: ExportClaim[];
  _instructions?: {
    confirmEndpoint: string;
    timeoutSeconds: number;
    requiredFields: string[];
  };
}

export interface MarkExportedRequest {
  claimIds: string[];
  fileName: string;
  format: string;
  hostname: string;
}

export interface MarkExportedResponse {
  ok: boolean;
  markedCount: number;
  message: string;
}

// NEW: Confirm Export Types for Queue System (v2.2.27+)
export interface ConfirmExportResult {
  claimId: string;
  success: boolean;
  fileName?: string;
  error?: string;
}

export interface ConfirmExportRequest {
  fetchId: string;
  hostname?: string;
  results: ConfirmExportResult[];
}

export interface ConfirmExportResponse {
  ok: boolean;
  fetchId: string;
  successCount: number;
  failCount: number;
  errors: Array<{ claimId: string; error: string }>;
  message: string;
}

// Queue Status Types (optional monitoring)
export interface QueueStatusResponse {
  ok: boolean;
  queue: {
    pending: number;
    fetched: number;
    exported: number;
    failed: number;
    none: number;
  };
  failedForRetry: number;
  permanentlyFailed: number;
  totalPendingOrFetched: number;
}

