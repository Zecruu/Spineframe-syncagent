import {
  HL7Message,
  MessageType,
  ParsedPatient,
  ParsedEncounter,
  ParsedNote,
  ParsedInsurance,
  ParsedCPTLine,
  ParsedAddress,
} from '../models/hl7Message';
import { getLogger } from './logger';

const logger = getLogger('HL7Parser');

// Parse HL7 date format YYYYMMDD to YYYY-MM-DD
function formatDate(hl7Date: string): string {
  if (!hl7Date || hl7Date.length < 8) return '';
  return `${hl7Date.substring(0, 4)}-${hl7Date.substring(4, 6)}-${hl7Date.substring(6, 8)}`;
}

// Parse HL7 datetime format YYYYMMDDHHMMSS to separate date and time
function formatDateTime(hl7DateTime: string): { date: string; time: string } {
  const date = formatDate(hl7DateTime);
  let time = '';
  if (hl7DateTime && hl7DateTime.length >= 12) {
    time = `${hl7DateTime.substring(8, 10)}:${hl7DateTime.substring(10, 12)}:${hl7DateTime.substring(12, 14) || '00'}`;
  }
  return { date, time };
}

// Format phone number
function formatPhone(phone: string): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `${digits.substring(0, 3)}-${digits.substring(3, 6)}-${digits.substring(6)}`;
  }
  return phone;
}

// Parse raw HL7 text into structured message
export function parseHL7(rawText: string): HL7Message {
  // Handle both \r and \n line endings
  const segments = rawText.split(/[\r\n]+/).filter(s => s.trim());
  const message: HL7Message = {
    raw: rawText,
    segments: {},
    messageType: 'UNKNOWN',
    messageControlId: '',
    dateTime: '',
    sendingFacility: '',
    sendingApplication: '',
  };

  for (const segment of segments) {
    const fields = segment.split('|');
    const segmentType = fields[0];

    if (!message.segments[segmentType]) {
      message.segments[segmentType] = [];
    }
    message.segments[segmentType].push(fields);
  }

  // Extract MSH info
  if (message.segments['MSH'] && message.segments['MSH'][0]) {
    const msh = message.segments['MSH'][0];
    message.sendingApplication = msh[2] || '';
    message.sendingFacility = msh[3] || '';
    message.dateTime = msh[6] || '';
    
    const msgType = msh[8] || '';
    message.messageType = parseMessageType(msgType);
    message.messageControlId = msh[9] || '';
  }

  logger.debug(`Parsed HL7 message type: ${message.messageType}, Control ID: ${message.messageControlId}`);
  return message;
}

function parseMessageType(msgTypeField: string): MessageType {
  const normalized = msgTypeField.replace(/\^/g, '^').toUpperCase();
  
  if (normalized.includes('ADT^A04')) return 'ADT^A04';
  if (normalized.includes('ADT^A08')) return 'ADT^A08';
  if (normalized.includes('ADT^A31')) return 'ADT^A31';
  if (normalized.includes('DFT^P03')) return 'DFT^P03';
  if (normalized.includes('ORU^R01')) return 'ORU^R01';
  
  return 'UNKNOWN';
}

// Parse address from HL7 format: Street^^City^State^Zip
function parseAddress(addressField: string): ParsedAddress {
  const parts = (addressField || '').split('^');
  return {
    line1: parts[0] || '',
    line2: parts[1] || '',
    city: parts[2] || '',
    state: parts[3] || '',
    zip: parts[4] || '',
  };
}

// Parse name from HL7 format: Last^First^Middle
function parseName(nameField: string): { lastName: string; firstName: string; middleName: string } {
  const parts = (nameField || '').split('^');
  return {
    lastName: parts[0] || '',
    firstName: parts[1] || '',
    middleName: parts[2] || '',
  };
}

// Extract patient from PID segment for ADT messages
export function parsePatientFromADT(message: HL7Message): ParsedPatient | null {
  if (!message.segments['PID'] || !message.segments['PID'][0]) {
    logger.warn('No PID segment found in message');
    return null;
  }

  const pid = message.segments['PID'][0];
  const name = parseName(pid[5]);
  const address = parseAddress(pid[11]);
  
  // Get external ID from field 3
  const externalIdField = pid[3] || '';
  const externalId = externalIdField.split('^')[0];

  const patient: ParsedPatient = {
    externalId,
    firstName: name.firstName,
    middleName: name.middleName,
    lastName: name.lastName,
    dob: formatDate(pid[7]),
    gender: pid[8] || '',
    phone: formatPhone(pid[13]),
    email: '', // Not typically in PID
    address,
    identifiers: {
      mrn: externalId,
      ssnLast4: (pid[19] || '').slice(-4),
    },
    insurance: [],
  };

  // Parse IN1 segments for insurance
  if (message.segments['IN1']) {
    for (const in1 of message.segments['IN1']) {
      const insurance = parseInsuranceFromIN1(in1);
      if (insurance) {
        patient.insurance.push(insurance);
      }
    }
  }

  logger.debug(`Parsed patient: ${patient.lastName}, ${patient.firstName} (ID: ${patient.externalId})`);
  return patient;
}

function parseInsuranceFromIN1(in1: string[]): ParsedInsurance | null {
  if (!in1 || in1.length < 4) return null;

  return {
    payerId: in1[3] || '',
    payerName: in1[4] || '',
    memberId: in1[36] || in1[2] || '', // Member ID can be in different fields
    groupId: in1[8] || '',
    relationship: in1[17] || 'self',
    planType: in1[2] || '',
  };
}

// Parse encounter/charge from DFT message
export function parseEncounterFromDFT(message: HL7Message): ParsedEncounter | null {
  if (!message.segments['PID'] || !message.segments['PID'][0]) {
    logger.warn('No PID segment found in DFT message');
    return null;
  }

  const pid = message.segments['PID'][0];
  const patientExternalId = (pid[3] || '').split('^')[0];

  // Get visit info from first FT1 segment
  const ft1 = message.segments['FT1']?.[0];
  const visitDate = ft1 ? formatDate(ft1[4]) : formatDateTime(message.dateTime).date;
  const visitTime = formatDateTime(message.dateTime).time;
  const visitExternalId = ft1?.[2] || message.messageControlId;

  const encounter: ParsedEncounter = {
    patientExternalId,
    visitExternalId,
    visitDate,
    visitTime,
    providerExternalId: '', // May need to parse from PV1 if available
    facilityExternalId: message.sendingFacility,
    icdCodes: [],
    cptLines: [],
    notes: '',
  };

  // Parse DG1 segments for ICD codes
  if (message.segments['DG1']) {
    for (const dg1 of message.segments['DG1']) {
      const icdCode = (dg1[3] || '').split('^')[0];
      if (icdCode && !encounter.icdCodes.includes(icdCode)) {
        encounter.icdCodes.push(icdCode);
      }
    }
  }

  // Parse FT1 segments for CPT lines
  if (message.segments['FT1']) {
    for (const ft1Seg of message.segments['FT1']) {
      const cptLine = parseCPTFromFT1(ft1Seg);
      if (cptLine) {
        encounter.cptLines.push(cptLine);
        // Also extract ICD codes from FT1 if present (field 19 or embedded)
        const diagField = ft1Seg[19] || '';
        const diags = diagField.split('~');
        for (const diag of diags) {
          const code = diag.split('^')[0];
          if (code && !encounter.icdCodes.includes(code)) {
            encounter.icdCodes.push(code);
          }
        }
      }
    }
  }

  logger.debug(`Parsed encounter for patient ${patientExternalId}, ${encounter.cptLines.length} CPT lines`);
  return encounter;
}

function parseCPTFromFT1(ft1: string[]): ParsedCPTLine | null {
  if (!ft1 || ft1.length < 7) return null;

  const codeField = ft1[7] || '';
  const codeParts = codeField.split('^');
  const code = codeParts[0];
  const description = codeParts[1] || '';

  if (!code) return null;

  return {
    code,
    modifiers: [], // Would need to parse from specific subfield
    units: parseInt(ft1[10], 10) || 1,
    amount: parseFloat(ft1[11]) || 0,
    description,
  };
}

// Parse clinical note from ORU message
export function parseNoteFromORU(message: HL7Message): ParsedNote | null {
  if (!message.segments['PID'] || !message.segments['PID'][0]) {
    logger.warn('No PID segment found in ORU message');
    return null;
  }

  const pid = message.segments['PID'][0];
  const patientExternalId = (pid[3] || '').split('^')[0];

  // Get visit/order info from OBR
  const obr = message.segments['OBR']?.[0];
  const visitExternalId = obr?.[2] || obr?.[3] || message.messageControlId;

  // Get note content from OBX segments
  let noteContent = '';
  if (message.segments['OBX']) {
    for (const obx of message.segments['OBX']) {
      const content = obx[5] || '';
      if (content) {
        noteContent += (noteContent ? '\n' : '') + content;
      }
    }
  }

  const note: ParsedNote = {
    patientExternalId,
    visitExternalId,
    noteType: 'chart',
    content: noteContent,
  };

  logger.debug(`Parsed note for patient ${patientExternalId}, ${noteContent.length} chars`);
  return note;
}

// Split batch HL7 file with multiple messages
export function splitHL7Batch(rawText: string): string[] {
  const messages: string[] = [];
  const parts = rawText.split(/(?=MSH\|)/);

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed && trimmed.startsWith('MSH|')) {
      messages.push(trimmed);
    }
  }

  return messages;
}

