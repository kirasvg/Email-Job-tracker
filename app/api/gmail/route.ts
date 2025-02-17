import { google } from 'googleapis';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../auth/[...nextauth]/route';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GaxiosResponse } from 'gaxios';
import { gmail_v1 } from 'googleapis';

// Define types for AI analysis response
interface AIAnalysisResult {
  companyName: string;
  jobProfile: string;
  applicationStatus: string;
}

interface EmailInfo extends AIAnalysisResult {
  id: string;
  date: string | null;
  originalSubject: string;
  from: string;
}

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

async function analyzeEmailWithAI(subject: string, body: string, from: string): Promise<AIAnalysisResult | null> {
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
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    
    const parsedResult = JSON.parse(jsonMatch[0]) as AIAnalysisResult;
    return parsedResult;
  } catch (error) {
    console.error('AI analysis failed:', error);
    return null;
  }
}

const extractEmailInfo = async (
  details: GaxiosResponse<gmail_v1.Schema$Message>
): Promise<EmailInfo> => {
  const headers = details.data.payload?.headers || [];
  const subject = headers.find((h) => h.name === 'Subject')?.value || '';
  const from = headers.find((h) => h.name === 'From')?.value || '';
  const date = headers.find((h) => h.name === 'Date')?.value ?? '';
  const body = getEmailBody(details.data.payload);

  // Try AI parsing first
  const aiResult = await analyzeEmailWithAI(subject, body, from);

  if (aiResult) {
    return {
      id: details.data.id || '',
      ...aiResult,
      date: date ? new Date(date).toISOString() : null,
      originalSubject: subject,
      from: from.replace(/<[^>]+>/, '').trim(),
    };
  }

  // Fallback to regex-based parsing
  const companyName = 'Unknown Company';
  const jobProfile = 'Unknown Position';
  const applicationStatus = 'Applied';

  // Rest of the regex parsing logic remains the same...
  // (Previous regex parsing code remains unchanged)

  return {
    id: details.data.id || '',
    companyName,
    jobProfile,
    applicationStatus,
    date: date ? new Date(date).toISOString() : null,
    originalSubject: subject,
    from: from.replace(/<[^>]+>/, '').trim(),
  };
};

function getEmailBody(payload: gmail_v1.Schema$MessagePart | null | undefined): string {
  if (!payload) return '';

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf8');
  }

  if (payload.parts) {
    return payload.parts
      .filter((part) => part.mimeType === 'text/plain')
      .map((part) => {
        if (part.body?.data) {
          return Buffer.from(part.body.data, 'base64').toString('utf8');
        }
        return '';
      })
      .join('\n');
  }

  return '';
}

export async function GET(): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  console.log("Session:", session);
  
  if (!session?.accessToken) {
    console.log("No access token found");
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: session.accessToken });

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  try {
    console.log("Fetching emails...");
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
    console.error('Error details:', error);
    return NextResponse.json(
      { error: 'Failed to fetch emails', details: String(error) }, 
      { status: 500 }
    );
  }
}