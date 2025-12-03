// HL7 DFT^P03 Message Generator for Export (SpineFrame → ProClaim)

import { ExportClaim, ExportClinicInfo } from '../models/api';

const HL7_SEGMENT_SEPARATOR = '\r';
const HL7_FIELD_SEPARATOR = '|';
const HL7_COMPONENT_SEPARATOR = '^';
const HL7_REPETITION_SEPARATOR = '~';

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const mins = String(date.getMinutes()).padStart(2, '0');
  const secs = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}${hours}${mins}${secs}`;
}

function formatAddress(addr?: { street?: string; city?: string; state?: string; zipCode?: string; zip?: string }): string {
  if (!addr) return '';
  const zip = addr.zipCode || addr.zip || '';
  return `${(addr.street || '').toUpperCase()}^^${(addr.city || '').toUpperCase()}^${(addr.state || '').toUpperCase()}^${zip}`;
}

function generateControlId(): string {
  return `SF${Date.now().toString(36).toUpperCase()}`;
}

export function generateDFTP03(claim: ExportClaim, clinic: ExportClinicInfo): string {
  const segments: string[] = [];
  const timestamp = formatDateTime(new Date().toISOString());
  const controlId = generateControlId();
  const dosFormatted = formatDate(claim.dateOfService);
  const dobFormatted = claim.patient.dob ? formatDate(claim.patient.dob) : '';
  
  // MSH - Message Header
  segments.push([
    'MSH',
    '^~\\&',
    'SPINEFRAME',
    clinic.code,
    'PROCLAIM',
    clinic.emrLinkType || 'EMD85',
    timestamp,
    '',
    'DFT^P03',
    controlId,
    'P',
    '2.4'
  ].join(HL7_FIELD_SEPARATOR));

  // EVN - Event Type
  segments.push([
    'EVN',
    'P03',
    timestamp
  ].join(HL7_FIELD_SEPARATOR));

  // PID - Patient Identification
  const patientName = `${(claim.patient.lastName || '').toUpperCase()}^${(claim.patient.firstName || '').toUpperCase()}^${(claim.patient.middleName || '').toUpperCase()}`;
  const patientAddress = formatAddress(claim.patient.address);
  const sex = claim.patient.sex === 'Female' ? 'F' : claim.patient.sex === 'Male' ? 'M' : 'U';
  
  segments.push([
    'PID',
    '1',
    '',
    `${claim.patient.proclaimPatientRecord || claim.patient.id}^^^PROCLAIM`,
    '',
    patientName,
    '',
    dobFormatted,
    sex,
    '',
    '',
    patientAddress,
    '',
    claim.patient.phone || ''
  ].join(HL7_FIELD_SEPARATOR));

  // PV1 - Patient Visit
  const visitId = `VIS${claim.claimId.substring(0, 10).toUpperCase()}`;
  segments.push([
    'PV1',
    '1',
    'O',
    clinic.code,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    visitId
  ].join(HL7_FIELD_SEPARATOR));

  // IN1 - Insurance
  const insuredName = `${(claim.patient.lastName || '').toUpperCase()}^${(claim.patient.firstName || '').toUpperCase()}`;
  segments.push([
    'IN1',
    '1',
    '',
    claim.payer.payerId,
    claim.payer.name,
    '',
    '',
    '',
    claim.payer.groupNumber || '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    insuredName,
    'self',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    claim.payer.memberId
  ].join(HL7_FIELD_SEPARATOR));

  // FT1 - Financial Transaction (one per billing code)
  const diagCodes = claim.diagnosisCodes.join(HL7_REPETITION_SEPARATOR);
  claim.billingCodes.forEach((code, index) => {
    const modifierStr = code.modifiers.length > 0 ? `:${code.modifiers.join(':')}` : '';
    segments.push([
      'FT1',
      String(index + 1),
      claim.claimId.substring(0, 20),
      '',
      dosFormatted,
      dosFormatted,
      'CG',
      `${code.code}${modifierStr}^${code.description.toUpperCase()}`,
      '',
      '',
      String(code.quantity),
      String(code.chargeAmount.toFixed(2)),
      '', '', '', '', '', '', '', '', '', '',
      diagCodes
    ].join(HL7_FIELD_SEPARATOR));
  });

  // DG1 - Diagnosis (one per diagnosis code)
  claim.diagnosisCodes.forEach((code, index) => {
    segments.push([
      'DG1',
      String(index + 1),
      'ICD10',
      `${code}^${code}`,
      '',
      '',
      'W'
    ].join(HL7_FIELD_SEPARATOR));
  });

  return segments.join(HL7_SEGMENT_SEPARATOR);
}

