import { NextResponse } from 'next/server';

export async function GET() {
  const jiraConnected = !!(
    process.env.JIRA_EMAIL && 
    process.env.JIRA_API_TOKEN
  );

  return NextResponse.json({
    status: 'ok',
    message: 'DMINT Dashboard API is running',
    jiraConnected: jiraConnected,
    domain: process.env.JIRA_DOMAIN || 'Not configured'
  });
}
