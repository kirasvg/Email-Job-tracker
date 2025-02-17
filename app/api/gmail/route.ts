import { google } from 'googleapis';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../auth/[...nextauth]/route';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

async function analyzeEmailWithAI(subject: string, body: string, from: string) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    const prompt = `
      Analyze this job application email and extract information in JSON format.
      
      Email Subject: "${subject}"
      Email From: "${from}"
      Email Body: "${body.substring(0, 1000)}"

      Return a JSON object with exactly these fields:
      {
        "companyName": "name of the company (extract from email domain if unclear)",
        "jobProfile": "the job position/role",
        "applicationStatus": "one of: Applied, Application Received, Interview, Rejected, or Offer"
      }

      Base your analysis on:
      1. Common recruiting email patterns
      2. Context clues from subject and body
      3. Email sender domain
      4. Status keywords and phrases
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    // Extract JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    
    const parsedResult = JSON.parse(jsonMatch[0]);
    return {
      companyName: parsedResult.companyName,
      jobProfile: parsedResult.jobProfile,
      applicationStatus: parsedResult.applicationStatus,
    };
  } catch (error) {
    console.error('AI analysis failed:', error);
    // Fallback to regex-based parsing if AI fails
    return null;
  }
}

const extractEmailInfo = async (details: any) => {
  const headers = details.data.payload?.headers || [];
  const subject = headers.find(h => h.name === 'Subject')?.value || '';
  const from = headers.find(h => h.name === 'From')?.value || '';
  const date = headers.find(h => h.name === 'Date')?.value;
  const body = getEmailBody(details.data.payload);

  // Try AI parsing first
  const aiResult = await analyzeEmailWithAI(subject, body, from);
  
  if (aiResult) {
    return {
      id: details.data.id,
      ...aiResult,
      date: date ? new Date(date).toISOString() : null,
      originalSubject: subject,
      from: from.replace(/<[^>]+>/, '').trim(),
    };
  }

  // Fallback to existing regex-based parsing
  let companyName = 'Unknown Company';
  let jobProfile = 'Unknown Position';
  let applicationStatus = 'Applied';

  // Common company name patterns in email addresses
  const emailDomain = from.match(/@([^>]+)>/)?.[1] || '';
  const companyDomain = emailDomain.split('.')[0];

  // Extract company name using multiple methods
  const companyPatterns = [
    // From subject patterns
    /(?:at|@|from)\s+([A-Za-z0-9\s&\.]+?)(?:\s+(?:for|position|role|about|regarding)|\s*$)/i,
    /^([A-Za-z0-9\s&\.]+?)(?:\s*[-–—|]|$)/,
    /([A-Za-z0-9\s&\.]+?)\s+(?:Careers|Jobs|Hiring|Recruitment)/i,
    
    // Common recruiting platforms
    /(?:workday|greenhouse|lever|indeed|linkedin)\s+on\s+behalf\s+of\s+([A-Za-z0-9\s&\.]+)/i,
    
    // From body patterns
    /(?:welcome\s+to|joining|application\s+(?:at|with|for))\s+([A-Za-z0-9\s&\.]+?)(?:\s+team|\s*[.!])/i
  ];

  // Try each pattern until we find a match
  for (const pattern of companyPatterns) {
    const match = (subject + ' ' + body).match(pattern);
    if (match?.[1]) {
      companyName = match[1].trim();
      break;
    }
  }

  // If no matches found, try using the email domain
  if (companyName === 'Unknown Company' && companyDomain) {
    companyName = companyDomain
      .replace(/(?:careers|jobs|hr|recruiting|talent)/i, '')
      .split(/[.-]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
      .trim();
  }

  // Extract job profile using multiple patterns
  const rolePatterns = [
    // From subject patterns
    /(?:for|position:|role:)\s+([^-|@\n.]+?)(?:\s+at|$)/i,
    /[-–—|]\s*([^-|@\n.]+?)(?:\s+at|$)/i,
    
    // Common job title patterns
    /(?:Software|Senior|Junior|Lead|Full[- ]Stack|Front[- ]End|Back[- ]End|DevOps|Cloud)\s+(?:Engineer|Developer|Architect|Developer)[^,\n]*/i,
    /(?:position|role|job)\s+(?:of|as|:)\s+([^,\n]+)/i,
    
    // From body patterns
    /applying\s+for\s+(?:the\s+)?(?:role\s+of\s+)?([^,\n.]+)/i,
    /position:\s*([^,\n.]+)/i
  ];

  // Try each pattern until we find a match
  for (const pattern of rolePatterns) {
    const match = (subject + ' ' + body).match(pattern);
    if (match?.[1]) {
      jobProfile = match[1].trim();
      break;
    }
  }

  // Determine application status with enhanced patterns
  const statusPatterns = {
    Rejected: [
      /(?:regret|unfortunately|not\s+moving\s+forward|not\s+selected|not\s+proceed|unsuccessful)/i,
      /thank\s+you\s+for\s+your\s+interest/i,
      /other\s+candidates|better\s+suited|not\s+the\s+best\s+fit/i
    ],
    Interview: [
      /(?:interview|next\s+steps|move\s+forward|schedule\s+a\s+call)/i,
      /technical\s+(?:round|assessment|challenge)|coding\s+challenge/i,
      /available\s+for\s+(?:a\s+)?(?:chat|call|meeting)/i
    ],
    'Offer': [
      /(?:offer|congratulations|welcome\s+aboard|joining|start\s+date)/i,
      /pleased\s+to\s+(?:offer|inform)|formal\s+offer/i
    ],
    'Application Received': [
      /(?:received|confirmed|submitted|reviewing|processing)\s+(?:your\s+)?application/i,
      /thank\s+you\s+for\s+(?:applying|your\s+application|your\s+interest)/i,
      /application\s+(?:confirmation|received|submitted)/i
    ]
  };

  // Check body content for status patterns
  const combinedText = (subject + ' ' + body).toLowerCase();
  for (const [status, patterns] of Object.entries(statusPatterns)) {
    if (patterns.some(pattern => pattern.test(combinedText))) {
      applicationStatus = status;
      break;
    }
  }

  return {
    id: details.data.id,
    companyName,
    jobProfile,
    applicationStatus,
    date: date ? new Date(date).toISOString() : null,
    originalSubject: subject,
    from: from.replace(/<[^>]+>/, '').trim(),
  };
};

// Helper function to extract email body content
function getEmailBody(payload: any): string {
  if (!payload) return '';

  // Handle different MIME types
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf8');
  }

  // Handle multipart messages
  if (payload.parts) {
    return payload.parts
      .filter((part: any) => part.mimeType === 'text/plain')
      .map((part: any) => {
        if (part.body?.data) {
          return Buffer.from(part.body.data, 'base64').toString('utf8');
        }
        return '';
      })
      .join('\n');
  }

  return '';
}

export async function GET() {
  const session = await getServerSession(authOptions);
  console.log("Session:", session); // Debug session
  
  if (!session?.accessToken) {
    console.log("No access token found"); // Debug auth
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: session.accessToken });

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  try {
    console.log("Fetching emails..."); // Debug API call
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: 'subject:(job OR application OR applied OR position OR opportunity OR software)',
      maxResults: 100,
    });

    const messages = response.data.messages || [];
    if (messages.length === 0) {
      console.log("No messages found matching the criteria");
      return NextResponse.json([]);
    }

    const messageDetails = await Promise.all(
      messages.map(async (message) => {
        const details = await gmail.users.messages.get({
          userId: 'me',
          id: message.id!,
          format: 'full',
        });
        return extractEmailInfo(details);
      })
    );

    return NextResponse.json(messageDetails);
  } catch (error) {
    console.error('Error details:', error); // Enhanced error logging
    return NextResponse.json({ error: 'Failed to fetch emails', details: error }, { status: 500 });
  }
} 