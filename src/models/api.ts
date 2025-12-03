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

