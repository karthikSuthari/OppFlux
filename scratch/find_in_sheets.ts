import { GoogleSpreadsheet, GoogleSpreadsheetRow } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { config } from '../src/config/env.js';

async function checkStatus() {
  console.log('Connecting to Google Sheets...');

  const auth = new JWT({
    email: config.googleServiceAccountEmail,
    key: config.googlePrivateKey.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const doc = new GoogleSpreadsheet(config.googleSheetsId, auth);
  await doc.loadInfo();
  console.log(`Connected to spreadsheet: "${doc.title}"`);

  const sheet = doc.sheetsByTitle['Opportunities'];
  if (!sheet) {
    console.log('Opportunities tab not found!');
    return;
  }

  const rows = await sheet.getRows();
  let found = false;
  rows.forEach((row) => {
    const id = row.get('id');
    if (id === '736a56a2') {
      console.log(`\n🔍 Found Opportunity ID: 736a56a2`);
      console.log(`Name: ${row.get('opportunity_name')}`);
      console.log(`Status: ${row.get('status')}`);
      found = true;
    }
  });

  if (!found) {
    console.log('\n❌ Could not find ID 736a56a2 in the Opportunities tab.');
  }
}

checkStatus().catch(console.error);
