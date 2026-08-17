declare module 'vader-sentiment' {
  export interface SentimentResult {
    neg: number;
    neu: number;
    pos: number;
    compound: number;
  }

  export interface SentimentIntensityAnalyzer {
    polarity_scores(text: string): SentimentResult;
  }

  export const SentimentIntensityAnalyzer: SentimentIntensityAnalyzer;

  const vader: {
    SentimentIntensityAnalyzer: SentimentIntensityAnalyzer;
  };

  export default vader;
}
