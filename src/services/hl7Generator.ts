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
  const patientRecordNumber = claim.patient.recordNumber || '';

  segments.push([
    'PID',
    '1',                                              // PID.1 - Set ID
    patientRecordNumber,                              // PID.2 - Patient External ID (Record Number)
    patientRecordNumber,                              // PID.3 - Patient ID List (Record Number)
    '',                                               // PID.4 - Alternate Patient ID
    patientName,                                      // PID.5 - Patient Name
    '',                                               // PID.6 - Mother's Maiden Name
    dobFormatted,                                     // PID.7 - Date of Birth
    sex,                                              // PID.8 - Sex
    '',                                               // PID.9 - Patient Alias
    '',                                               // PID.10 - Race
    patientAddress,                                   // PID.11 - Patient Address
    '',                                               // PID.12 - County Code
    claim.patient.phone || ''                         // PID.13 - Phone Number - Home
  ].join(HL7_FIELD_SEPARATOR));

  // PV1 - Patient Visit
  const visitId = `VIS${claim.claimId.substring(0, 10).toUpperCase()}`;
  const billingNPI = claim.billingProvider?.npi || clinic.npi || '';
  const renderingNPI = claim.renderingProvider?.npi || '';
  const renderingName = claim.renderingProvider?.name || '';
  const attendingDoctor = renderingNPI ? `${renderingNPI}${HL7_COMPONENT_SEPARATOR}${renderingName}` : '';

  segments.push([
    'PV1',
    '1',
    'O',                    // PV1.2 - Patient Class (O = Outpatient)
    '',                     // PV1.3 - Assigned Patient Location
    '',                     // PV1.4
    '',                     // PV1.5
    attendingDoctor,        // PV1.7 - Attending Doctor (NPI^Name)
    attendingDoctor,        // PV1.8 - Referring Doctor (NPI^Name)
    '',                     // PV1.9
    '',                     // PV1.10
    '',                     // PV1.11
    '',                     // PV1.12
    '',                     // PV1.13
    '',                     // PV1.14
    '',                     // PV1.15
    '',                     // PV1.16
    '',                     // PV1.17
    '',                     // PV1.18
    visitId                 // PV1.19 - Visit Number
  ].join(HL7_FIELD_SEPARATOR));

  // IN1 - Insurance
  const insuredName = `${(claim.patient.lastName || '').toUpperCase()}^${(claim.patient.firstName || '').toUpperCase()}`;
  // SpineFrame uses "policyNumber" for what HL7 calls memberId
  const memberId = claim.payer.policyNumber || claim.payer.memberId || '';
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
    memberId                                            // IN1.36 - Policy Number / Member ID
  ].join(HL7_FIELD_SEPARATOR));

  // FT1 - Financial Transaction (one per billing code)
  // Format diagnosis codes as {code}^^ICD~{code2}^^ICD per HL7 2.4
  const diagCodesFormatted = claim.diagnosisCodes
    .map(code => `${code}${HL7_COMPONENT_SEPARATOR}${HL7_COMPONENT_SEPARATOR}ICD`)
    .join(HL7_REPETITION_SEPARATOR);
  const performedBy = renderingNPI ? `${renderingNPI}${HL7_COMPONENT_SEPARATOR}${renderingName}` : '';

  claim.billingCodes.forEach((code, index) => {
    const procedureCode = `${code.code}${HL7_COMPONENT_SEPARATOR}${code.description.toUpperCase()}`;
    // FT1.26 - Procedure Code Modifiers (up to 4 modifiers, tilde-separated)
    const modifiersArray = (code.modifiers || []).slice(0, 4);
    const modifiers = modifiersArray.length > 0 ? modifiersArray.join(HL7_REPETITION_SEPARATOR) : '';
    segments.push([
      'FT1',
      String(index + 1),                              // FT1.1 - Set ID
      claim.claimId.substring(0, 20),                 // FT1.2 - Transaction ID
      '',                                             // FT1.3 - Transaction Batch ID
      dosFormatted,                                   // FT1.4 - Transaction Date
      dosFormatted,                                   // FT1.5 - Transaction Posting Date
      'CG',                                           // FT1.6 - Transaction Type (CG = Charge)
      '',                                             // FT1.7 - Transaction Code (empty, using FT1.25)
      '',                                             // FT1.8 - Transaction Description
      '',                                             // FT1.9 - Transaction Description Alt
      String(code.quantity),                          // FT1.10 - Transaction Quantity
      String(code.chargeAmount.toFixed(2)),           // FT1.11 - Transaction Amount Extended
      '',                                             // FT1.12 - Transaction Amount Unit
      '',                                             // FT1.13 - Department Code
      '',                                             // FT1.14 - Insurance Plan ID
      '',                                             // FT1.15 - Insurance Amount
      clinic.code,                                    // FT1.16 - Assigned Patient Location
      '',                                             // FT1.17 - Fee Schedule
      '',                                             // FT1.18 - Patient Type
      diagCodesFormatted,                             // FT1.19 - Diagnosis Codes ({code}^^ICD~{code2}^^ICD)
      performedBy,                                    // FT1.20 - Performed By Code (NPI^Name)
      '',                                             // FT1.21 - Ordered By Code
      '',                                             // FT1.22 - Unit Cost
      '',                                             // FT1.23 - Filler Order Number
      '',                                             // FT1.24 - Entered By Code
      procedureCode,                                  // FT1.25 - Procedure Code (CPT^Description)
      modifiers                                       // FT1.26 - Procedure Code Modifiers
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

