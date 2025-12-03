// HL7 v2.x Message Types

export type MessageType = 'ADT^A04' | 'ADT^A08' | 'ADT^A31' | 'DFT^P03' | 'ORU^R01' | 'UNKNOWN';

export interface HL7Segment {
  type: string;
  fields: string[];
}

export interface HL7Message {
  raw: string;
  segments: Record<string, string[][]>;
  messageType: MessageType;
  messageControlId: string;
  dateTime: string;
  sendingFacility: string;
  sendingApplication: string;
}

export interface ParsedName {
  lastName: string;
  firstName: string;
  middleName: string;
}

export interface ParsedAddress {
  line1: string;
  line2: string;
  city: string;
  state: string;
  zip: string;
}

export interface ParsedInsurance {
  payerId: string;
  payerName: string;
  memberId: string;
  groupId: string;
  relationship: string;
  planType: string;
}

export interface ParsedPatient {
  externalId: string;
  firstName: string;
  middleName: string;
  lastName: string;
  dob: string;
  gender: string;
  phone: string;
  email: string;
  address: ParsedAddress;
  identifiers: {
    mrn: string;
    ssnLast4: string;
  };
  insurance: ParsedInsurance[];
}

export interface ParsedCPTLine {
  code: string;
  modifiers: string[];
  units: number;
  amount: number;
  description: string;
}

export interface ParsedEncounter {
  patientExternalId: string;
  visitExternalId: string;
  visitDate: string;
  visitTime: string;
  providerExternalId: string;
  facilityExternalId: string;
  icdCodes: string[];
  cptLines: ParsedCPTLine[];
  notes: string;
}

export interface ParsedNote {
  patientExternalId: string;
  visitExternalId: string;
  noteType: string;
  content: string;
}

