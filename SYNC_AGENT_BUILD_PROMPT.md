# 🧩 SUPER PROMPT – Build SpineFrame HL7 Sync Agent (Windows Desktop App)

You are an expert Windows desktop application developer. Your task is to build the **SpineFrame HL7 Sync Agent** - a lightweight Windows application that runs in the system tray, watches a local folder for HL7 files exported from ProClaim (a chiropractic billing software), parses them into JSON, and sends them to the SpineFrame cloud API.

---

## 📋 Project Overview

**Name:** SpineFrame HL7 Sync Agent
**Platform:** Windows 10/11 (64-bit)  
**Language:** C# (.NET 8) or Electron/Node.js (your choice based on best UX)  
**Type:** System tray application with minimal UI  
**Purpose:** Bridge between local ProClaim HL7 exports and SpineFrame cloud EHR

### High-Level Flow
```
ProClaim → Exports HL7 files → Watch Folder → Sync Agent → Parse to JSON → SpineFrame API
```

---

## 🎯 Core Requirements

### 1. System Tray Application
- Runs minimized to system tray (not taskbar)
- Tray icon shows sync status (green = connected, yellow = syncing, red = error)
- Right-click menu: "Open Dashboard", "Sync Now", "Settings", "View Logs", "Exit"
- Double-click tray icon opens mini dashboard
- Auto-start with Windows (optional, configurable)

### 2. Configuration (First-Run Wizard)
On first launch, show a setup wizard:
1. **API Configuration**
   - SpineFrame API URL (default: `https://api.spineframe.com`)
   - Clinic ID (provided by admin)
   - API Key (provided by admin - 64-character hex string)
   - "Test Connection" button
   
2. **Watch Folder Configuration**
   - Path to ProClaim HL7 export folder (e.g., `C:\ProClaim\HL7Export`)
   - "Browse" button to select folder
   - Validate folder exists and is readable

3. **Processing Options**
   - After successful sync: Move to "Processed" subfolder / Delete / Leave in place
   - Retry failed files: Yes/No, Max retries (default: 3)
   - Sync interval for heartbeat (default: 60 seconds)

Store config in: `%APPDATA%\SpineFrameSyncAgent\config.json`

### 3. File Watcher
- Watch the configured folder for new `.hl7` files
- Support patterns: `*.hl7`, `*.HL7`, `*.txt` (HL7 content)
- Debounce: Wait 500ms after file creation before processing (ensure file is fully written)
- Process files in order (oldest first by creation time)
- Skip files currently being written (check file lock)

### 4. HL7 Parser
Parse standard HL7 v2.x messages. The main message types from ProClaim are:
- **ADT^A04/A08** - Patient registration/update
- **DFT^P03** - Detailed Financial Transaction (charges)
- **ORU^R01** - Observation/Results (clinical notes)

---

## 📡 SpineFrame API Integration

Base URL: Configurable (default: `https://api.spineframe.com`)

### Authentication Headers (Required for ALL requests)
```
Authorization: Bearer <API_KEY>
X-Clinic-Id: <CLINIC_ID>
X-Agent-Version: 1.0.0
X-Agent-Hostname: <COMPUTER_NAME>
```

### Endpoints

#### 1. POST /api/hl7/agent-heartbeat
Send every 60 seconds to indicate agent is alive.

**Request:**
```json
{
  "agentVersion": "1.0.0",
  "hostname": "FRONTDESK-PC",
  "osUser": "Reception1",
  "watchFolder": "C:\\ProClaim\\HL7Export",
  "pendingFiles": 0,
  "lastSyncAt": "2024-01-15T10:30:00Z"
}
```

**Response (200 OK):**
```json
{
  "ok": true,
  "serverTime": "2024-01-15T10:30:05Z",
  "clinicCode": "SPINE001",
  "message": "Heartbeat received"
}
```

#### 2. POST /api/hl7/patient-upsert
Create or update a patient from ADT message.

**Request:**
```json
{
  "externalSystem": "ProClaim",
  "externalId": "PAT-12345",
  "firstName": "Jane",
  "middleName": "Marie",
  "lastName": "Doe",
  "dob": "1988-05-15",
  "gender": "F",
  "phone": "787-555-1234",
  "email": "jane.doe@email.com",
  "address": {
    "line1": "123 Main St",
    "line2": "Apt 4B",
    "city": "San Juan",
    "state": "PR",
    "zip": "00901"
  },
  "identifiers": {
    "mrn": "MRN-001234",
    "ssnLast4": "5678"
  },
  "insurance": [
    {
      "payerId": "BCBS001",
      "payerName": "Blue Cross Blue Shield",
      "memberId": "XYZ123456789",
      "groupId": "GRP001",
      "relationship": "self",
      "planType": "PPO"
    }
  ]
}
```

**Response (200 OK):**
```json
{
  "ok": true,
  "patientId": "6789abcd1234ef5678901234",
  "created": false,
  "message": "Patient updated successfully"
}
```

#### 3. POST /api/hl7/encounter-charge
Create visit/encounter with CPT charges from DFT message.

**Request:**
```json
{
  "externalSystem": "ProClaim",
  "patientExternalId": "PAT-12345",
  "visitExternalId": "VIS-98765",
  "visitDate": "2024-01-15",
  "visitTime": "14:30:00",
  "providerExternalId": "DR-001",
  "facilityExternalId": "FAC-001",
  "icdCodes": ["M54.5", "M99.01", "M99.03"],
  "cptLines": [
    {
      "code": "98941",
      "modifiers": ["GP"],
      "units": 1,
      "amount": 65.00,
      "description": "CMT 3-4 regions"
    },
    {
      "code": "97140",
      "modifiers": ["GP", "59"],
      "units": 2,
      "amount": 45.00,
      "description": "Manual therapy"
    }
  ],
  "notes": "Follow-up visit, patient reports 60% improvement"
}
```

**Response (200 OK):**
```json
{
  "ok": true,
  "encounterId": "abc123def456789012345678",
  "created": true,
  "message": "Encounter created successfully"
}
```

#### 4. POST /api/hl7/note
Store clinical note from ORU message.

**Request:**
```json
{
  "externalSystem": "ProClaim",
  "patientExternalId": "PAT-12345",
  "visitExternalId": "VIS-98765",
  "noteType": "chart",
  "content": "Patient presents with lower back pain radiating to left leg..."
}
```

**Response (200 OK):**
```json
{
  "ok": true,
  "patientId": "6789abcd1234ef5678901234",
  "visitId": "abc123def456789012345678",
  "message": "Note stored successfully"
}
```

#### 5. GET /api/hl7/status
Check integration status.

**Response (200 OK):**
```json
{
  "ok": true,
  "status": {
    "enabled": true,
    "mode": "ProClaim",
    "agentLastHeartbeat": "2024-01-15T10:30:05Z",
    "stats": {
      "totalMessagesReceived": 1250,
      "totalErrors": 3
    }
  }
}
```

### Error Responses
All endpoints return errors in this format:
```json
{
  "ok": false,
  "error": "Human-readable error message",
  "code": "ERROR_CODE",
  "details": "Additional details (dev mode only)"
}
```

**Common Error Codes:**
- `VALIDATION_ERROR` (400) - Missing or invalid fields
- `PATIENT_NOT_FOUND` (404) - Patient external ID not found
- `UNAUTHORIZED` (401) - Invalid API key or clinic ID
- `FORBIDDEN` (403) - HL7 not enabled for clinic
- `INTERNAL_ERROR` (500) - Server error

---

## 📄 HL7 Parsing Guide

### HL7 Message Structure
HL7 v2.x messages are pipe-delimited text with segments separated by carriage returns.

```
MSH|^~\&|PROCLAIM|CLINIC001|SPINEFRAME|CLOUD|20240115143000||ADT^A08|MSG00001|P|2.3
EVN|A08|20240115143000
PID|1||PAT-12345^^^PROCLAIM||DOE^JANE^MARIE||19880515|F|||123 MAIN ST^^SAN JUAN^PR^00901||7875551234|||||5678
IN1|1|PPO|BCBS001|BLUE CROSS BLUE SHIELD||||GRP001||||||||DOE^JANE|self|19880515|123 MAIN ST^^SAN JUAN^PR^00901||||||||||||XYZ123456789
```

### Key Segments to Parse

#### MSH (Message Header) - Present in ALL messages
```
MSH|^~\&|SendingApp|SendingFacility|ReceivingApp|ReceivingFacility|DateTime||MessageType^TriggerEvent|MessageControlID|ProcessingID|Version
```
- Field 7: DateTime (format: YYYYMMDDHHMMSS)
- Field 9: Message Type (e.g., ADT^A08, DFT^P03)
- Field 10: Message Control ID (unique ID for this message)

#### PID (Patient Identification) - For ADT messages
```
PID|SetID||PatientID^^^AssigningAuth||LastName^FirstName^MiddleName||DOB|Gender|||Address||Phone|||||SSN
```
- Field 3: Patient ID (external ID)
- Field 5: Name (Last^First^Middle)
- Field 7: DOB (YYYYMMDD)
- Field 8: Gender (M/F/O)
- Field 11: Address (Street^^City^State^Zip)
- Field 13: Phone
- Field 19: SSN (last 4 if partial)

#### IN1 (Insurance) - For ADT messages
```
IN1|SetID|PlanID|PayerID|PayerName||||GroupNumber||||||||Insured^Name|Relationship|DOB|Address||||||||||||MemberID
```

#### FT1 (Financial Transaction) - For DFT messages
```
FT1|SetID|TransactionID|TransactionBatchID|TransactionDate|TransactionPostDate|TransactionType|TransactionCode^Description|TransactionDescription||Quantity|Amount||||||||||||DiagnosisCode1~DiagnosisCode2
```

#### DG1 (Diagnosis) - For DFT messages
```
DG1|SetID|DiagnosisCodingMethod|DiagnosisCode^Description|||DiagnosisType
```

### Sample Parser Pseudocode
```javascript
function parseHL7(rawText) {
  const segments = rawText.split('\r').filter(s => s.trim());
  const message = { segments: {} };

  for (const segment of segments) {
    const fields = segment.split('|');
    const segmentType = fields[0]; // MSH, PID, IN1, FT1, etc.

    if (!message.segments[segmentType]) {
      message.segments[segmentType] = [];
    }
    message.segments[segmentType].push(fields);
  }

  return message;
}

function parsePatientFromPID(pidFields) {
  const nameParts = (pidFields[5] || '').split('^');
  const addressParts = (pidFields[11] || '').split('^');

  return {
    externalId: pidFields[3]?.split('^')[0],
    lastName: nameParts[0],
    firstName: nameParts[1],
    middleName: nameParts[2],
    dob: formatDate(pidFields[7]), // YYYYMMDD -> YYYY-MM-DD
    gender: pidFields[8],
    phone: pidFields[13],
    address: {
      line1: addressParts[0],
      city: addressParts[2],
      state: addressParts[3],
      zip: addressParts[4]
    }
  };
}
```

---

## 🖥️ UI Requirements

### 1. Mini Dashboard (Main Window)
Small, clean window (~400x500px) with:

**Header:**
- SpineFrame logo + "Sync Agent"
- Connection status indicator (green dot + "Connected to SpineFrame")

**Stats Panel:**
- Files synced today: 47
- Files pending: 2
- Last sync: 2 minutes ago
- Errors (24h): 0

**Recent Activity List:**
- Scrollable list of last 20 operations
- Format: `[10:30 AM] ✓ Patient "Jane Doe" updated`
- Error format: `[10:25 AM] ✗ Failed: Invalid patient ID`

**Action Buttons:**
- "Sync Now" - Process pending files immediately
- "Open Watch Folder" - Opens folder in Explorer
- "Settings" gear icon

### 2. Settings Window
Tabbed interface:

**Tab 1: Connection**
- API URL input
- Clinic ID input
- API Key input (masked, show/hide toggle)
- "Test Connection" button
- Connection status display

**Tab 2: Folders**
- Watch folder path + Browse button
- Processed files folder path + Browse button
- "Delete files after sync" checkbox
- "Move to processed folder" checkbox

**Tab 3: Behavior**
- Auto-start with Windows checkbox
- Sync interval (seconds) spinner
- Max retry attempts spinner
- Show notifications checkbox
- Minimize to tray on close checkbox

**Tab 4: Logs**
- Log level dropdown (Error, Warning, Info, Debug)
- "Open Log Folder" button
- "Clear Logs" button
- Log file size display

### 3. System Tray
**Icon States:**
- 🟢 Green: Connected, idle
- 🟡 Yellow: Syncing in progress
- 🔴 Red: Error or disconnected
- ⚪ Gray: Disabled/paused

**Tooltip:** "SpineFrame Sync Agent - Connected (47 files synced today)"

**Right-Click Menu:**
```
📊 Open Dashboard
🔄 Sync Now
⏸️ Pause Syncing / ▶️ Resume Syncing
───────────────
⚙️ Settings
📁 Open Watch Folder
📋 View Logs
───────────────
❌ Exit
```

---

## 📁 File Structure (Suggested)

```
SpineFrameSyncAgent/
├── src/
│   ├── main/                    # Main process (Electron) or Program.cs (.NET)
│   │   ├── index.ts             # Entry point
│   │   ├── tray.ts              # System tray management
│   │   ├── watcher.ts           # File system watcher
│   │   └── config.ts            # Configuration management
│   │
│   ├── services/
│   │   ├── hl7Parser.ts         # HL7 text to JSON parser
│   │   ├── apiClient.ts         # SpineFrame API client
│   │   ├── syncService.ts       # Orchestrates sync operations
│   │   └── logger.ts            # Logging service
│   │
│   ├── models/
│   │   ├── hl7Message.ts        # HL7 message types
│   │   ├── patient.ts           # Patient DTO
│   │   ├── encounter.ts         # Encounter/Visit DTO
│   │   └── config.ts            # Configuration types
│   │
│   └── ui/                      # Renderer process (Electron) or WPF/WinUI
│       ├── dashboard/
│       ├── settings/
│       └── components/
│
├── assets/
│   ├── icons/                   # Tray icons (green, yellow, red, gray)
│   └── logo.png
│
├── config/
│   └── default.json             # Default configuration
│
├── logs/                        # Log files (created at runtime)
│
├── package.json                 # If Electron
├── SpineFrameSyncAgent.csproj   # If .NET
└── README.md
```

---

## 🔄 Sync Flow (Detailed)

```
┌─────────────────────────────────────────────────────────────────┐
│                        STARTUP SEQUENCE                          │
├─────────────────────────────────────────────────────────────────┤
│ 1. Load config from %APPDATA%\SpineFrameSyncAgent\config.json   │
│ 2. If no config → Show Setup Wizard                              │
│ 3. Validate API credentials (call /api/hl7/status)               │
│ 4. Start file watcher on configured folder                       │
│ 5. Start heartbeat timer (every 60s)                             │
│ 6. Process any existing files in watch folder                    │
│ 7. Show system tray icon (green if connected)                    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     FILE PROCESSING FLOW                         │
├─────────────────────────────────────────────────────────────────┤
│ 1. File watcher detects new .hl7 file                           │
│ 2. Wait 500ms (debounce - ensure file is fully written)         │
│ 3. Check file is not locked (ProClaim still writing)            │
│ 4. Read file contents                                            │
│ 5. Parse HL7 text into structured object                         │
│ 6. Determine message type from MSH segment                       │
│ 7. Transform to SpineFrame JSON payload                          │
│ 8. Send to appropriate API endpoint                              │
│ 9. On success:                                                   │
│    - Log success                                                 │
│    - Move file to Processed folder (or delete)                   │
│    - Update stats                                                │
│ 10. On error:                                                    │
│    - Log error with details                                      │
│    - Move file to Failed folder                                  │
│    - Increment retry counter (if retries enabled)                │
│    - Show notification (if enabled)                              │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                       MESSAGE TYPE ROUTING                       │
├─────────────────────────────────────────────────────────────────┤
│ MSH Message Type    │  API Endpoint            │  Transformer   │
│─────────────────────┼──────────────────────────┼────────────────│
│ ADT^A04 (Register)  │ /api/hl7/patient-upsert  │ adtToPatient() │
│ ADT^A08 (Update)    │ /api/hl7/patient-upsert  │ adtToPatient() │
│ ADT^A31 (Update)    │ /api/hl7/patient-upsert  │ adtToPatient() │
│ DFT^P03 (Charge)    │ /api/hl7/encounter-charge│ dftToEncounter()│
│ ORU^R01 (Results)   │ /api/hl7/note            │ oruToNote()    │
│ Unknown             │ Log warning, skip        │ -              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔐 Security Requirements

1. **API Key Storage**
   - Store API key encrypted using Windows DPAPI (Data Protection API)
   - Never log the full API key (mask to first 8 + last 4 chars)
   - Clear from memory after use

2. **HTTPS Only**
   - Enforce TLS 1.2+ for API communication
   - Validate SSL certificates

3. **File Handling**
   - Validate file size limits (reject files > 10MB)
   - Sanitize file paths to prevent directory traversal
   - Process only .hl7 extension files

4. **Logging**
   - Log file rotation (max 10MB per file, keep last 7 days)
   - Never log PHI (patient names, SSNs, etc.) in plain text
   - Sanitize error messages before logging

---

## 📊 Logging Requirements

Log to: `%APPDATA%\SpineFrameSyncAgent\logs\sync-YYYY-MM-DD.log`

**Log Format:**
```
[2024-01-15 10:30:45.123] [INFO] [Watcher] New file detected: ADT_20240115_001.hl7
[2024-01-15 10:30:45.456] [INFO] [Parser] Parsed ADT^A08 message, Patient ID: PAT-12345
[2024-01-15 10:30:45.789] [INFO] [API] POST /api/hl7/patient-upsert - 200 OK (234ms)
[2024-01-15 10:30:45.890] [INFO] [Sync] File processed successfully, moved to Processed/
[2024-01-15 10:31:00.000] [DEBUG] [Heartbeat] Sent heartbeat - 200 OK
[2024-01-15 10:32:15.000] [ERROR] [API] POST /api/hl7/patient-upsert failed - 400 VALIDATION_ERROR: Missing firstName
```

**Log Levels:**
- ERROR: API failures, parse errors, file errors
- WARNING: Retries, unknown message types, skipped files
- INFO: Successful syncs, file movements, config changes
- DEBUG: Heartbeats, detailed parse info, API request/response bodies

---

## ⚙️ Configuration Schema

`%APPDATA%\SpineFrameSyncAgent\config.json`:

```json
{
  "version": "1.0",
  "api": {
    "baseUrl": "https://api.spineframe.com",
    "clinicId": "clinic_mongodb_id_here",
    "apiKey": "encrypted:base64_encrypted_key_here"
  },
  "folders": {
    "watch": "C:\\ProClaim\\HL7Export",
    "processed": "C:\\ProClaim\\HL7Export\\Processed",
    "failed": "C:\\ProClaim\\HL7Export\\Failed"
  },
  "behavior": {
    "autoStart": true,
    "syncIntervalSeconds": 60,
    "maxRetries": 3,
    "deleteAfterSync": false,
    "moveToProcessed": true,
    "showNotifications": true,
    "minimizeToTray": true
  },
  "logging": {
    "level": "INFO",
    "maxFileSizeMB": 10,
    "retentionDays": 7
  }
}
```

---

## 🧪 Testing Checklist

### Unit Tests
- [ ] HL7 parser correctly extracts PID segment fields
- [ ] HL7 parser correctly extracts IN1 (insurance) segments
- [ ] HL7 parser correctly extracts FT1 (charges) segments
- [ ] HL7 parser handles multi-line messages
- [ ] Date format conversion (YYYYMMDD → YYYY-MM-DD)
- [ ] Phone number formatting
- [ ] Address parsing with missing fields
- [ ] API client handles 401/403/500 errors correctly
- [ ] Config encryption/decryption works

### Integration Tests
- [ ] File watcher detects new files
- [ ] File watcher ignores non-.hl7 files
- [ ] Debounce prevents processing incomplete files
- [ ] Successful sync moves file to Processed folder
- [ ] Failed sync moves file to Failed folder
- [ ] Retry logic works for transient errors
- [ ] Heartbeat sends every N seconds

### Manual Tests
- [ ] First-run wizard completes setup
- [ ] Test Connection button works
- [ ] Settings are persisted across restarts
- [ ] Auto-start with Windows works
- [ ] System tray icon changes color correctly
- [ ] Notifications appear for errors
- [ ] Log viewer shows correct entries

---

## 📦 Deliverables

1. **Installer** - MSI or MSIX package for Windows 10/11
2. **Source Code** - Clean, documented, with README
3. **User Guide** - PDF with setup instructions and screenshots
4. **Sample HL7 Files** - Test files for each message type

---

## 🚀 Getting Started

1. Clone the repository
2. Install dependencies
3. Create a test ProClaim HL7 export folder
4. Get a test Clinic ID and API key from SpineFrame admin panel
5. Run the app and complete the setup wizard
6. Drop a sample .hl7 file into the watch folder
7. Verify the data appears in SpineFrame

---

## 📝 Sample HL7 Files for Testing

### Sample ADT^A08 (Patient Update)
```
MSH|^~\&|PROCLAIM|CLINICA001|SPINEFRAME|CLOUD|20240115143000||ADT^A08|MSG001|P|2.3
EVN|A08|20240115143000
PID|1||12345^^^PROCLAIM||DOE^JANE^MARIE||19880515|F|||123 MAIN ST^^SAN JUAN^PR^00901||7875551234|||||||5678
IN1|1|PPO|BCBS001|BLUE CROSS BLUE SHIELD||||GRP001||||||||DOE^JANE|self|19880515|123 MAIN ST^^SAN JUAN^PR^00901||||||||||||XYZ123456789
```

### Sample DFT^P03 (Charge)
```
MSH|^~\&|PROCLAIM|CLINICA001|SPINEFRAME|CLOUD|20240115150000||DFT^P03|MSG002|P|2.3
EVN|P03|20240115150000
PID|1||12345^^^PROCLAIM||DOE^JANE^MARIE||19880515|F
FT1|1|FT001||20240115|20240115|CG|98941^CMT 3-4 REGIONS|||1|65.00||||||||||||M54.5~M99.01
FT1|2|FT002||20240115|20240115|CG|97140^MANUAL THERAPY|||2|45.00||||||||||||M54.5
DG1|1|ICD10|M54.5^LOW BACK PAIN|||W
DG1|2|ICD10|M99.01^SEGMENTAL DYSFUNCTION CERVICAL|||W
```

### Sample ORU^R01 (Clinical Note)
```
MSH|^~\&|PROCLAIM|CLINICA001|SPINEFRAME|CLOUD|20240115151500||ORU^R01|MSG003|P|2.3
PID|1||12345^^^PROCLAIM||DOE^JANE^MARIE||19880515|F
OBR|1|ORD001|ORD001|NOTE^CLINICAL NOTE|||20240115151500
OBX|1|TX|NOTE^CLINICAL NOTE||Patient reports 60% improvement in lower back pain. Range of motion improved. Continue current treatment plan.||||||F
```

---

## ❓ FAQ / Edge Cases

**Q: What if the same patient is in multiple HL7 files at once?**
A: Process in order by file creation timestamp. SpineFrame API handles upsert logic.

**Q: What if ProClaim exports the same patient twice with different IDs?**
A: This is a ProClaim configuration issue. The agent uses whatever externalId is in the PID segment.

**Q: What if the API is down?**
A: Move file to Failed folder, retry based on config. Show red tray icon. Continue heartbeat attempts.

**Q: What about very large files?**
A: Reject files > 10MB with a warning. Log and move to Failed folder.

**Q: Can it handle batch files with multiple messages?**
A: Yes, split on MSH segments and process each message separately.

---

**Good luck building the SpineFrame HL7 Sync Agent! 🚀**