import vader from 'vader-sentiment';

import { config } from '../config/alpaca.js';
import { database, type Database } from '../db/database.js';
import type { NewsArticle, StockSentiment } from '../types/alpaca.js';

import { alpacaService } from './alpacaService.js';
import { cacheService } from './cacheService.js';
import { Logger } from './logger.js';

const TOP_STOCKS = [
  'AAPL',
  'NVDA',
  'TSLA',
  'MSFT',
  'AMZN',
  'META',
  'GOOGL',
  'AMD',
  'NFLX',
  'PLTR',
  'SPY',
  'QQQ',
  'QCOM',
  'DIS',
  'COIN',
  'JPM',
  'V',
  'UNH',
  'BA',
  'COST',
];
const CACHE_TTL_SECONDS = 3600; // 1 hour TTL to protect API quotas

interface WebzPost {
  uuid: string;
  url: string;
  title: string;
  text: string;
  summary: string;
  published: string;
  entities?: {
    organizations?: {
      name: string;
      tickers?: { ticker: string | null; exchange: string | null }[];
    }[];
  };
}

interface NewsApiArticle {
  title: string;
  description: string;
  url: string;
  publishedAt: string;
  source: { name: string };
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

export class NewsService {
  constructor(private readonly database: Database) {}

  isMediaReleasePost(text: string): boolean {
    if (!text) {
      return false;
    }
    return /\b(WEB-DL|1080p|720p|4k|HDR|H264|x264|HEVC|x265|torrent|S\d{1,2}E\d{1,2}|DUAL|CMRG|VARYG|AAC2|REPACK)\b/i.test(text);
  }

  calculateSentiment(text: string): number {
    if (!text) {
      return 0;
    }
    try {
      const intensity = vader.SentimentIntensityAnalyzer.polarity_scores(text);
      return Math.round((intensity.compound || 0) * 100) / 100;
    } catch {
      return 0;
    }
  }

  async analyzeSentimentWithGemini(
    symbol: string,
    headlines: string[],
  ): Promise<{ score: number; sentiment: 'BEARISH' | 'BULLISH' | 'NEUTRAL'; topHeadline?: string } | null> {
    const apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey || !headlines.length) {
      return null;
    }

    try {
      const prompt = `You are an elite Wall Street quantitative analyst. Analyze the following news headlines for stock symbol "${symbol}". 
Determine the financial sentiment and score between -1.0 (extremely bearish) and +1.0 (extremely bullish).
Also select the single headline that was the primary driver of your financial sentiment score.

Headlines:
${headlines.map((headline, index) => `${index + 1}. ${headline}`).join('\n')}

Respond STRICTLY with valid JSON in this exact format (no markdown code blocks):
{"score": 0.85, "sentiment": "BULLISH", "topHeadline": "Exact headline string that drove this score"}`;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as GeminiResponse;
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const cleanedText = rawText.replaceAll('```json', '').replaceAll('```', '').trim();

      const parsed = JSON.parse(cleanedText);
      const score = typeof parsed.score === 'number' ? Math.max(-1, Math.min(1, parsed.score)) : 0;
      const rawSentiment = String(parsed.sentiment || '').toUpperCase();
      const sentiment: 'BEARISH' | 'BULLISH' | 'NEUTRAL' = ['BULLISH', 'BEARISH', 'NEUTRAL'].includes(rawSentiment)
        ? (rawSentiment as 'BEARISH' | 'BULLISH' | 'NEUTRAL')
        : 'NEUTRAL';
      const topHeadline = parsed.topHeadline || undefined;

      return { score, sentiment, topHeadline };
    } catch (error) {
      Logger.warn(
        `Gemini 3.6 Flash sentiment call for ${symbol} failed: ${error instanceof Error ? error.message : String(error)}. Falling back to VADER.`,
      );
      return null;
    }
  }

  /**
   * Returns a cached Gemini sentiment or computes (and caches) a fresh one for the given headlines.
   */
  private async fetchGeminiSentiment(
    symbol: string,
    headlines: string[],
    vaderAvg: number,
  ): Promise<{ score: number; sentiment: 'BEARISH' | 'BULLISH' | 'NEUTRAL'; topHeadline?: string } | null> {
    const headlineFingerprint = `gemini_sent:${symbol}:${headlines.join('|')}`;
    const cached = await cacheService.get<{ score: number; sentiment: 'BEARISH' | 'BULLISH' | 'NEUTRAL'; topHeadline?: string }>(
      headlineFingerprint,
    );
    if (cached) {
      return cached;
    }
    Logger.info(`Event Trigger: Calling Gemini 3.6 Flash for ${symbol} (VADER score: ${vaderAvg})...`);
    const result = await this.analyzeSentimentWithGemini(symbol, headlines);
    if (result) {
      await cacheService.set(headlineFingerprint, result, 86_400); // Fingerprint cached for 24h
    }
    return result;
  }

  async fetchNewsForSymbols(symbols: string[] = TOP_STOCKS): Promise<Record<string, NewsArticle[]>> {
    const cacheKey = `news:${symbols.sort().join('_')}`;

    const cached = await cacheService.get<Record<string, NewsArticle[]>>(cacheKey);
    if (cached) {
      Logger.info('Returning cached news (1h TTL) to protect API quotas...');
      return cached;
    }

    Logger.info(`Fetching fresh news for: ${symbols.join(', ')}...`);

    let result: Record<string, NewsArticle[]> = {};

    if (process.env.WEBZ_TOKEN) {
      try {
        result = await this.fetchFromWebz(symbols);
        Logger.info(
          `Webz.io → ${Object.values(result).reduce((sum, articles) => sum + articles.length, 0)} articles across ${Object.values(result).filter((articles) => articles.length > 0).length} symbols`,
        );
      } catch (error) {
        Logger.warn(`Webz.io failed: ${error instanceof Error ? error.message : String(error)}. Falling back to NewsAPI.org...`);
      }
    }

    const hasArticles = Object.values(result).some((articles) => articles.length > 0);
    if (!hasArticles && process.env.NEWSAPI_KEY) {
      try {
        result = await this.fetchFromNewsApi(symbols);
        Logger.info(
          `NewsAPI.org → ${Object.values(result).reduce((sum, articles) => sum + articles.length, 0)} articles across ${Object.values(result).filter((articles) => articles.length > 0).length} symbols`,
        );
      } catch (error) {
        Logger.warn(`NewsAPI.org failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const hasAnyArticles = Object.values(result).some((articles) => articles.length > 0);
    if (!hasAnyArticles) {
      try {
        result = await this.fetchFromAlpacaNews(symbols);
      } catch {
        Logger.warn('Failed to fetch Alpaca news.');
      }
    }

    for (const symbol of symbols) {
      if (!result[symbol]) {
        result[symbol] = [];
      }
    }

    await cacheService.set(cacheKey, result, CACHE_TTL_SECONDS);
    return result;
  }

  async analyzeNewsSentiment(customSymbols?: string[], useGemini = false): Promise<StockSentiment[]> {
    const symbols = customSymbols?.length ? customSymbols : await alpacaService.getTopMovers();
    const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY);
    Logger.info(
      `Analyzing ${hasGeminiKey && useGemini ? 'GEMINI 3.6 FLASH' : 'VADER'} news sentiment across dynamic watchlist (${symbols.slice(0, 5).join(', ')}...)...`,
    );

    const newsMap = await this.fetchNewsForSymbols(symbols);
    const sentiments: StockSentiment[] = [];

    for (const symbol of symbols) {
      const articles = newsMap[symbol] || [];
      if (!articles.length) {
        sentiments.push({
          symbol,
          score: 0,
          sentiment: 'NEUTRAL',
          headlineCount: 0,
          topHeadline: 'No recent news articles found',
          headlines: [],
        });
        continue;
      }

      const headlines = articles.map((article) => article.headline).filter(Boolean);

      // 1. Free VADER Pre-Filter
      let totalVaderScore = 0;
      for (const article of articles) {
        totalVaderScore += this.calculateSentiment(`${article.headline}. ${article.summary || ''}`);
      }
      const vaderAvg = Math.round((totalVaderScore / articles.length) * 100) / 100;

      // 2. Strict Cost Guard: Only call Gemini if VADER detects non-zero sentiment (|vaderAvg| >= 0.05) and key exists
      let geminiResult: { score: number; sentiment: 'BEARISH' | 'BULLISH' | 'NEUTRAL'; topHeadline?: string } | null = null;

      if (hasGeminiKey && useGemini && Math.abs(vaderAvg) >= 0.05) {
        geminiResult = await this.fetchGeminiSentiment(symbol, headlines, vaderAvg);
      }

      if (geminiResult) {
        Logger.info(`Gemini 3.6 Flash LLM Sentiment for ${symbol}: Score=${geminiResult.score}, Category=${geminiResult.sentiment}`);
        sentiments.push({
          symbol,
          score: geminiResult.score,
          sentiment: geminiResult.sentiment,
          headlineCount: articles.length,
          topHeadline: geminiResult.topHeadline || articles[0]?.headline || 'N/A',
          headlines,
        });
        continue;
      }

      // Fallback: VADER sentiment calculation
      let category: StockSentiment['sentiment'] = 'NEUTRAL';
      if (vaderAvg >= 0.15) {
        category = 'BULLISH';
      } else if (vaderAvg <= -0.15) {
        category = 'BEARISH';
      }

      sentiments.push({
        symbol,
        score: vaderAvg,
        sentiment: category,
        headlineCount: articles.length,
        topHeadline: articles[0]?.headline || 'N/A',
        headlines,
      });
    }

    sentiments.sort((a, b) => b.score - a.score);

    try {
      this.database.saveNewsSentiments(sentiments);
    } catch {
      Logger.warn('Failed to save news sentiments.');
    }

    if (sentiments[0]) {
      Logger.info(`Top ${hasGeminiKey && useGemini ? 'Gemini 3.6 Flash' : 'VADER'} sentiment stock:`, sentiments[0]);
    }
    return sentiments;
  }

  clearCache(): void {
    void cacheService.clearAll();
  }

  private tickerInText(text: string, ticker: string): boolean {
    return new RegExp(String.raw`\b${ticker}\b`, 'i').test(text);
  }

  private async fetchFromWebz(symbols: string[]): Promise<Record<string, NewsArticle[]>> {
    const query = `language:"english" AND (${symbols.join(' OR ')})`;
    const url = `https://api.webz.io/api/news?token=${process.env.WEBZ_TOKEN || ''}&q=${encodeURIComponent(query)}&sort=crawled&format=json&size=30&includeSyndicated=false`;

    const resultBySymbol: Record<string, NewsArticle[]> = {};
    for (const symbol of symbols) {
      resultBySymbol[symbol] = [];
    }

    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`Webz.io returned ${response.status}`);
    }

    const data = (await response.json()) as { posts?: WebzPost[] };
    const posts = data.posts || [];

    for (const post of posts) {
      const title = post.title || '';
      const summary = post.summary || '';
      const combinedText = `${title} ${summary}`.toUpperCase();

      if (this.isMediaReleasePost(title) || this.isMediaReleasePost(summary)) {
        continue;
      }

      const tickers: string[] = [];
      const orgs = post.entities?.organizations || [];
      for (const org of orgs) {
        for (const ticker of org.tickers || []) {
          const sym = ticker.ticker?.toUpperCase();
          if (sym && symbols.includes(sym) && !tickers.includes(sym) && this.tickerInText(combinedText, sym)) {
            tickers.push(sym);
          }
        }
      }

      if (!tickers.length) {
        continue;
      }

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

  private async fetchFromNewsApi(symbols: string[]): Promise<Record<string, NewsArticle[]>> {
    const resultBySymbol: Record<string, NewsArticle[]> = {};
    for (const symbol of symbols) {
      resultBySymbol[symbol] = [];
    }

    const promises = symbols.map(async (sym) => {
      const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(sym)}&apiKey=${process.env.NEWSAPI_KEY || ''}&pageSize=10&sortBy=publishedAt&language=en`;
      const response = await fetch(url);
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { articles?: NewsApiArticle[] };
      const articles = data.articles || [];

      for (const article of articles) {
        const title = article.title || '';
        const desc = article.description || '';

        if (this.isMediaReleasePost(title) || this.isMediaReleasePost(desc)) {
          continue;
        }
        if (!this.tickerInText(`${title} ${desc}`, sym)) {
          continue;
        }

        resultBySymbol[sym].push({
          id: article.url,
          headline: title,
          summary: desc,
          url: article.url,
          symbols: [sym],
          created_at: article.publishedAt || '',
        });
      }
    });

    await Promise.all(promises);
    return resultBySymbol;
  }

  private async fetchFromAlpacaNews(symbols: string[]): Promise<Record<string, NewsArticle[]>> {
    const creds = config.getAlpacaCredentials();
    const url = `${creds.dataUrl}/v1beta1/news?symbols=${symbols.join(',')}&limit=30`;

    const headers: Record<string, string> = {
      'APCA-API-KEY-ID': creds.keyId,
      'APCA-API-SECRET-KEY': creds.secretKey,
    };

    const resultBySymbol: Record<string, NewsArticle[]> = {};
    for (const sym of symbols) {
      resultBySymbol[sym] = [];
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      return resultBySymbol;
    }

    const data = (await response.json()) as { news?: NewsArticle[] };
    const articles = data.news || [];

    for (const article of articles) {
      const headline = article.headline || '';
      const summary = article.summary || '';
      if (this.isMediaReleasePost(headline) || this.isMediaReleasePost(summary)) {
        continue;
      }

      const articleSymbols = article.symbols || [];
      for (const sym of symbols) {
        if (articleSymbols.includes(sym)) {
          if (articleSymbols.length > 3 && !this.tickerInText(`${headline} ${summary}`, sym)) {
            continue;
          }
          resultBySymbol[sym].push(article);
        }
      }
    }

    return resultBySymbol;
  }
}

export const newsService = new NewsService(database);
