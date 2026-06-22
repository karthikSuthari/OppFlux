/**
 * Google Sheets Automation: Generate Description on Approval
 * 
 * INSTRUCTIONS:
 * 1. Open your Google Sheet
 * 2. Click Extensions > Apps Script
 * 3. Delete any code there, and paste all of this code.
 * 4. Replace YOUR_GEMINI_API_KEY_HERE with your actual Gemini API Key.
 * 5. Make sure you add a new column to your Opportunities sheet (e.g., Column M) and insert Checkboxes.
 * 6. Save the project and test it!
 */

// ================= CONFIGURATION =================
const GEMINI_API_KEY = "YOUR_GEMINI_API_KEY_HERE"; 
const OPPORTUNITIES_SHEET_NAME = "Opportunities";
const DESCRIPTIONS_SHEET_NAME = "Descriptions";

// Column Indexes (1-based, meaning A=1, B=2, C=3, etc.)
// Updated to match your screenshot!
const COL_CHECKBOX = 1;   // A
const COL_ID = 2;         // B
const COL_OPP_NAME = 3;   // C
const COL_ORGANIZER = 4;  // D
const COL_MODE = 5;       // E
const COL_FEES = 6;       // F
const COL_LOCATION = 7;   // G
const COL_LINK = 8;       // H
const COL_DEADLINE = 9;   // I
const COL_ELIGIBILITY = 10;// J
const COL_REWARDS = 11;   // K
const COL_STATUS = 12;    // L

// ================= TRIGGER FUNCTION =================
function onEdit(e) {
  if (!e || !e.range) return;
  
  const sheet = e.range.getSheet();
  const row = e.range.getRow();
  const col = e.range.getColumn();
  
  // Rule 1: Only run on the Opportunities sheet
  if (sheet.getName() !== OPPORTUNITIES_SHEET_NAME) return;
  
  // Rule 2: Only run if the edited cell is the Status column
  if (col !== COL_STATUS) return;
  
  // Rule 3: Only run if the new status is "approved"
  const newStatus = String(e.value).toLowerCase();
  if (newStatus !== "approved") return;
  
  // Rule 4: Check if the checkbox is already ticked
  const checkboxValue = sheet.getRange(row, COL_CHECKBOX).getValue();
  if (checkboxValue === true) return; // Skip if already generated
  
  // Extract all the required fields from the row
  const oppName = sheet.getRange(row, COL_OPP_NAME).getValue();
  const organizer = sheet.getRange(row, COL_ORGANIZER).getValue();
  const deadline = sheet.getRange(row, COL_DEADLINE).getValue();
  const eligibility = sheet.getRange(row, COL_ELIGIBILITY).getValue();
  const rewards = sheet.getRange(row, COL_REWARDS).getValue();
  const mode = sheet.getRange(row, COL_MODE).getValue();
  const location = sheet.getRange(row, COL_LOCATION).getValue();
  const fees = sheet.getRange(row, COL_FEES).getValue();
  
  // Call Gemini
  const description = generateDescriptionWithGemini(oppName, organizer, deadline, eligibility, rewards, mode, location, fees);
  
  // Also get the registration link to paste into the Descriptions sheet
  const link = sheet.getRange(row, COL_LINK || 4).getValue(); // Defaulting COL_LINK to 4 (D) if not defined
  
  if (description) {
    // 1. Add to the new Descriptions sheet
    let descSheet = e.source.getSheetByName(DESCRIPTIONS_SHEET_NAME);
    if (!descSheet) {
      descSheet = e.source.insertSheet(DESCRIPTIONS_SHEET_NAME);
      descSheet.appendRow(["Event Name", "Description", "Link"]);
    }
    descSheet.appendRow([oppName, description, link]);
    
    // 2. Tick the checkbox in the original sheet
    sheet.getRange(row, COL_CHECKBOX).setValue(true);
  } else {
    SpreadsheetApp.getUi().alert('Failed to generate description with Gemini. Check Apps Script executions log.');
  }
}

// ================= GEMINI API CALL =================
function generateDescriptionWithGemini(oppName, organizer, deadline, eligibility, rewards, mode, location, fees) {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" + GEMINI_API_KEY;
  
  // 📝 THIS IS THE STRUCTURE OF THE DESCRIPTION
  // Feel free to modify this prompt exactly how you want it!
  const promptText = `
You are an expert copywriter for student opportunities. 
Write a professional, engaging description for the following opportunity. 
Structure it with a brief engaging intro, bullet points for key details, and a clear call to action.

Opportunity Name: ${oppName}
Organizer: ${organizer}
Deadline: ${deadline}
Eligibility: ${eligibility}
Rewards: ${rewards}
Mode: ${mode}
Location: ${location}
Fees: ${fees}
  `;

  const payload = {
    "contents": [{
      "parts": [{
        "text": promptText
      }]
    }]
  };

  const options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const json = JSON.parse(response.getContentText());
    if (json.candidates && json.candidates[0] && json.candidates[0].content) {
      return json.candidates[0].content.parts[0].text;
    } else {
      Logger.log("Error from Gemini API: " + response.getContentText());
      return null;
    }
  } catch (err) {
    Logger.log("Fetch failed: " + err);
    return null;
  }
}
