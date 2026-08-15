import vader from 'vader-sentiment';
import dotenv from 'dotenv';
import { getAlpacaCredentials } from '../config/alpaca.js';
import { saveNewsSentimentsDb } from '../db/database.js';
import { getCache, setCache, clearAllCache } from './cacheService.js';
import { getTopMovers } from './alpacaService.js';
import { NewsArticle, StockSentiment } from '../types/alpaca.js';
import { createLogger } from './logger.js';

dotenv.config();
const log = createLogger('NewsService');

const TOP_STOCKS = [
  'AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMZN', 'META', 'GOOGL', 'AMD',
  'NFLX', 'PLTR', 'SPY', 'QQQ', 'QCOM', 'DIS', 'COIN', 'JPM',
  'V', 'UNH', 'BA', 'COST'
];
const CACHE_TTL_SECONDS = 3600; // 1 hour TTL to protect API quotas

// Read at call time (not import time) so tests can set these before calling.

export function isMediaReleasePost(text: string): boolean {
  if (!text) return false;
  return /\b(WEB-DL|1080p|720p|4k|HDR|H264|x264|HEVC|x265|torrent|S\d{1,2}E\d{1,2}|DUAL|CMRG|VARYG|AAC2|REPACK)\b/i.test(text);
}

interface WebzPost {
  uuid: string;
  url: string;
  title: string;
  text: string;
  summary: string;
  published: string;
  entities?: {
    organizations?: Array<{
      name: string;
      tickers?: Array<{ ticker: string | null; exchange: string | null }>;
    }>;
  };
}

interface NewsApiArticle {
  title: string;
  description: string;
  url: string;
  publishedAt: string;
  source: { name: string };
}

export function calculateSentiment(text: string): number {
  if (!text || typeof text !== 'string') return 0;
  try {
    const intensity = vader.SentimentIntensityAnalyzer.polarity_scores(text);
    return Math.round((intensity.compound || 0) * 100) / 100;
  } catch {
    return 0;
  }
}

export async function analyzeSentimentWithGemini(
  symbol: string,
  headlines: string[]
): Promise<{ score: number; sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; topHeadline?: string } | null> {
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey || !headlines || headlines.length === 0) return null;

  try {
    const prompt = `You are an elite Wall Street quantitative analyst. Analyze the following news headlines for stock symbol "${symbol}". 
Determine the financial sentiment and score between -1.0 (extremely bearish) and +1.0 (extremely bullish).
Also select the single headline that was the primary driver of your financial sentiment score.

Headlines:
${headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')}

Respond STRICTLY with valid JSON in this exact format (no markdown code blocks):
{"score": 0.85, "sentiment": "BULLISH", "topHeadline": "Exact headline string that drove this score"}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    if (!response.ok) return null;

    const data = (await response.json()) as any;
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim();

    const parsed = JSON.parse(cleanedText);
    const score = typeof parsed.score === 'number' ? Math.max(-1, Math.min(1, parsed.score)) : 0;
    const rawSent = String(parsed.sentiment || '').toUpperCase();
    const sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = ['BULLISH', 'BEARISH', 'NEUTRAL'].includes(rawSent)
      ? (rawSent as 'BULLISH' | 'BEARISH' | 'NEUTRAL')
      : 'NEUTRAL';
    const topHeadline = typeof parsed.topHeadline === 'string' && parsed.topHeadline ? parsed.topHeadline : undefined;

    return { score, sentiment, topHeadline };
  } catch (error: any) {
    log.warn(`Gemini 3.6 Flash sentiment call for ${symbol} failed: ${error.message}. Falling back to VADER.`);
    return null;
  }
}

function tickerInText(text: string, ticker: string): boolean {
  return new RegExp(`\\b${ticker}\\b`, 'i').test(text);
}

async function fetchFromWebz(symbols: string[]): Promise<Record<string, NewsArticle[]>> {
  const query = `language:"english" AND (${symbols.join(' OR ')})`;
  const url = `https://api.webz.io/api/news?token=${process.env.WEBZ_TOKEN || ''}&q=${encodeURIComponent(query)}&sort=crawled&format=json&size=30&includeSyndicated=false`;

  const resultBySymbol: Record<string, NewsArticle[]> = {};
  symbols.forEach(s => { resultBySymbol[s] = []; });

  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`Webz.io returned ${res.status}`);

  const data = await res.json() as { posts?: WebzPost[] };
  const posts = data.posts || [];

  for (const post of posts) {
    const title = post.title || '';
    const summary = post.summary || '';
    const combinedText = `${title} ${summary}`.toUpperCase();

    const tickers: string[] = [];
    if (isMediaReleasePost(title) || isMediaReleasePost(summary)) continue;

    const orgs = post.entities?.organizations || [];
    for (const org of orgs) {
      for (const t of org.tickers || []) {
        const sym = t.ticker?.toUpperCase();
        if (sym && symbols.includes(sym) && !tickers.includes(sym) && tickerInText(combinedText, sym)) {
          tickers.push(sym);
        }
      }
    }

    if (tickers.length === 0) continue;

    const article: NewsArticle = {
      id: post.uuid,
      headline: title,
      summary,
      url: post.url || '',
      symbols: tickers,
      created_at: post.published || '',
    };

    for (const sym of tickers) {
      resultBySymbol[sym].push(article);
    }
  }

  return resultBySymbol;
}

async function fetchFromNewsApi(symbols: string[]): Promise<Record<string, NewsArticle[]>> {
  const resultBySymbol: Record<string, NewsArticle[]> = {};
  symbols.forEach(s => { resultBySymbol[s] = []; });

  const promises = symbols.map(async (sym) => {
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(sym)}&apiKey=${process.env.NEWSAPI_KEY || ''}&pageSize=10&sortBy=publishedAt&language=en`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json() as { articles?: NewsApiArticle[] };
    const articles = data.articles || [];

    for (const a of articles) {
      const title = a.title || '';
      const desc = a.description || '';

      if (isMediaReleasePost(title) || isMediaReleasePost(desc)) continue;
      if (!tickerInText(`${title} ${desc}`, sym)) continue;

      resultBySymbol[sym].push({
        id: a.url,
        headline: title,
        summary: desc,
        url: a.url,
        symbols: [sym],
        created_at: a.publishedAt || '',
      });
    }
  });

  await Promise.all(promises);
  return resultBySymbol;
}

async function fetchFromAlpacaNews(symbols: string[]): Promise<Record<string, NewsArticle[]>> {
  const creds = getAlpacaCredentials();
  const url = `${creds.dataUrl}/v1beta1/news?symbols=${symbols.join(',')}&limit=30`;

  const headers: Record<string, string> = {
    'APCA-API-KEY-ID': creds.keyId,
    'APCA-API-SECRET-KEY': creds.secretKey,
  };

  const resultBySymbol: Record<string, NewsArticle[]> = {};
  symbols.forEach(sym => { resultBySymbol[sym] = []; });

  const response = await fetch(url, { headers });
  if (!response.ok) {
    return resultBySymbol;
  }

  const data = await response.json() as { news?: NewsArticle[] };
  const articles = data.news || [];

  for (const article of articles) {
    const articleSymbols = article.symbols || [];
    for (const sym of symbols) {
      if (articleSymbols.includes(sym)) {
        resultBySymbol[sym].push(article);
      }
    }
  }

  return resultBySymbol;
}

export async function fetchNewsForSymbols(symbols: string[] = TOP_STOCKS): Promise<Record<string, NewsArticle[]>> {
  const cacheKey = `news:${symbols.sort().join('_')}`;

  const cached = await getCache<Record<string, NewsArticle[]>>(cacheKey);
  if (cached) {
    log.info('Returning cached news (1h TTL) to protect API quotas...');
    return cached;
  }

  log.info(`Fetching fresh news for: ${symbols.join(', ')}...`);

  let result: Record<string, NewsArticle[]> = {};

  if (process.env.NODE_ENV === 'test') {
    result = await fetchFromAlpacaNews(symbols);
    await setCache(cacheKey, result, CACHE_TTL_SECONDS);
    return result;
  }

  if (process.env.WEBZ_TOKEN) {
    try {
      result = await fetchFromWebz(symbols);
      log.info(`Webz.io → ${Object.values(result).reduce((s,a)=>s+a.length,0)} articles across ${Object.values(result).filter(a=>a.length>0).length} symbols`);
    } catch (err: any) {
      log.warn(`Webz.io failed: ${err.message}. Falling back to NewsAPI.org...`);
    }
  }

  const hasArticles = Object.values(result).some(a => a.length > 0);
  if (!hasArticles && process.env.NEWSAPI_KEY) {
    try {
      result = await fetchFromNewsApi(symbols);
      log.info(`NewsAPI.org → ${Object.values(result).reduce((s,a)=>s+a.length,0)} articles across ${Object.values(result).filter(a=>a.length>0).length} symbols`);
    } catch (err: any) {
      log.warn(`NewsAPI.org failed: ${err.message}`);
    }
  }

  const hasAnyArticles = Object.values(result).some(a => a.length > 0);
  if (!hasAnyArticles) {
    try {
      result = await fetchFromAlpacaNews(symbols);
    } catch {
      // Ignore
    }
  }

  symbols.forEach(s => { if (!result[s]) result[s] = []; });

  await setCache(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

export async function analyzeNewsSentiment(customSymbols?: string[], useGemini: boolean = false): Promise<StockSentiment[]> {
  const symbols = (customSymbols && customSymbols.length > 0) ? customSymbols : await getTopMovers();
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY);
  log.info(`Analyzing ${hasGeminiKey && useGemini ? 'GEMINI 3.6 FLASH' : 'VADER'} news sentiment across dynamic watchlist (${symbols.slice(0, 5).join(', ')}...)...`);

  const newsMap = await fetchNewsForSymbols(symbols);
  const sentiments: StockSentiment[] = [];

  for (const symbol of symbols) {
    const articles = newsMap[symbol] || [];
    if (articles.length === 0) {
      sentiments.push({ symbol, score: 0, sentiment: 'NEUTRAL', headlineCount: 0, topHeadline: 'No recent news articles found', headlines: [] });
      continue;
    }

    const headlines = articles.map(a => a.headline).filter(Boolean);

    // 1. Free VADER Pre-Filter
    let totalVaderScore = 0;
    for (const art of articles) {
      totalVaderScore += calculateSentiment(`${art.headline}. ${art.summary || ''}`);
    }
    const vaderAvg = Math.round((totalVaderScore / articles.length) * 100) / 100;

    // 2. Strict Cost Guard: Only call Gemini if VADER detects non-zero sentiment (|vaderAvg| >= 0.05) and key exists
    let geminiRes: { score: number; sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; topHeadline?: string } | null = null;

    if (hasGeminiKey && useGemini && Math.abs(vaderAvg) >= 0.05) {
      const headlineFingerprint = `gemini_sent:${symbol}:${headlines.join('|')}`;
      const cachedGemini = await getCache<{ score: number; sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; topHeadline?: string }>(headlineFingerprint);

      if (cachedGemini) {
        geminiRes = cachedGemini;
      } else {
        log.info(`Event Trigger: Calling Gemini 3.6 Flash for ${symbol} (VADER score: ${vaderAvg})...`);
        geminiRes = await analyzeSentimentWithGemini(symbol, headlines);
        if (geminiRes) {
          await setCache(headlineFingerprint, geminiRes, 86400); // Fingerprint cached for 24h
        }
      }
    }

    if (geminiRes) {
      log.info(`Gemini 3.6 Flash LLM Sentiment for ${symbol}: Score=${geminiRes.score}, Category=${geminiRes.sentiment}`);
      sentiments.push({
        symbol,
        score: geminiRes.score,
        sentiment: geminiRes.sentiment,
        headlineCount: articles.length,
        topHeadline: geminiRes.topHeadline || articles[0]?.headline || 'N/A',
        headlines
      });
      continue;
    }

    // Fallback: VADER sentiment calculation
    let category: StockSentiment['sentiment'] = 'NEUTRAL';
    if (vaderAvg >= 0.15) category = 'BULLISH';
    else if (vaderAvg <= -0.15) category = 'BEARISH';

    sentiments.push({ symbol, score: vaderAvg, sentiment: category, headlineCount: articles.length, topHeadline: articles[0]?.headline || 'N/A', headlines });
  }

  sentiments.sort((a, b) => b.score - a.score);

  try { saveNewsSentimentsDb(sentiments); } catch {}

  if (sentiments[0]) {
    log.info(`Top ${hasGeminiKey && useGemini ? 'Gemini 3.6 Flash' : 'VADER'} sentiment stock:`, sentiments[0]);
  }
  return sentiments;
}

export function clearNewsCache() {
  clearAllCache();
}
