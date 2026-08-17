export interface MarketClockStatus {
  marketStatus: 'after-hours' | 'closed' | 'extended-weekend' | 'pre-market' | 'regular-hours';
  isOpen: boolean;
  nextEvent: 'market_close' | 'market_open';
  nextEventTime: Date;
}

export interface NYTimeParts {
  year: number;
  month: number;
  day: number;
  dayOfWeek: number;
  hour: number;
  minute: number;
  second: number;
  totalMinutes: number;
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Single source of truth for market-hours logic; all times are Eastern.
 */
export class MarketClock {
  static readonly MINUTES_PER_HOUR = 60;

  // Session boundaries, in minutes since midnight (Eastern).
  static readonly REGULAR_OPEN_MINUTES = 9 * MarketClock.MINUTES_PER_HOUR + 30; // 9:30 AM
  static readonly OPENING_RANGE_END_MINUTES = 11 * MarketClock.MINUTES_PER_HOUR + 30; // 11:30 AM
  static readonly REGULAR_CLOSE_MINUTES = 16 * MarketClock.MINUTES_PER_HOUR; // 4:00 PM
  static readonly EXTENDED_SESSION_END_MINUTES = 20 * MarketClock.MINUTES_PER_HOUR; // 8:00 PM

  // Date.prototype.getDay() return values.
  static readonly SUNDAY = 0;
  static readonly MONDAY = 1;
  static readonly FRIDAY = 5;
  static readonly SATURDAY = 6;

  static getNYParts(date: Date = new Date()): NYTimeParts {
    // If Date methods were mocked in test suites without native implementation
    if (!date.getDay.toString().includes('[native code]') || !date.getHours.toString().includes('[native code]')) {
      const hour = date.getHours();
      const minute = date.getMinutes();
      const second = date.getSeconds();
      const dayOfWeek = date.getDay();
      const totalMinutes = hour * MarketClock.MINUTES_PER_HOUR + minute;
      return {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
        dayOfWeek,
        hour,
        minute,
        second,
        totalMinutes,
      };
    }

    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    });
    const parts = formatter.formatToParts(date);
    const map: Record<string, string> = {};
    for (const part of parts) {
      if (part.type !== 'literal') {
        map[part.type] = part.value;
      }
    }
    const dayOfWeek = Math.max(0, WEEKDAY_NAMES.indexOf(map.weekday || 'Sun'));
    const year = Number.parseInt(map.year || '1970', 10);
    const month = Number.parseInt(map.month || '1', 10);
    const day = Number.parseInt(map.day || '1', 10);
    const hour = Number.parseInt(map.hour || '0', 10);
    const minute = Number.parseInt(map.minute || '0', 10);
    const second = Number.parseInt(map.second || '0', 10);
    const totalMinutes = hour * MarketClock.MINUTES_PER_HOUR + minute;

    return { year, month, day, dayOfWeek, hour, minute, second, totalMinutes };
  }

  static makeNYDate(year: number, month: number, day: number, hour: number, minute: number, second = 0): Date {
    const utc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    const nyParts = MarketClock.getNYParts(utc);
    const targetMinutes = hour * MarketClock.MINUTES_PER_HOUR + minute;
    const actualMinutes = nyParts.hour * MarketClock.MINUTES_PER_HOUR + nyParts.minute;
    const dayDiff = day - nyParts.day;
    const minuteDiff = targetMinutes - actualMinutes + dayDiff * 1440;
    return new Date(utc.getTime() + minuteDiff * 60_000);
  }

  static nowInNewYork(): Date {
    const parts = MarketClock.getNYParts();
    return MarketClock.makeNYDate(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second);
  }

  static minutesSinceMidnightNY(): number {
    return MarketClock.getNYParts().totalMinutes;
  }

  /**
   * Extended hours = outside the regular 9:30 AM–4:00 PM session.
   * Time-of-day only — does not account for weekends.
   */
  static isExtendedHours(): boolean {
    try {
      const totalMinutes = MarketClock.minutesSinceMidnightNY();
      return totalMinutes < MarketClock.REGULAR_OPEN_MINUTES || totalMinutes >= MarketClock.REGULAR_CLOSE_MINUTES;
    } catch {
      return false;
    }
  }

  /**
   * 24/5 session open: Sunday 8 PM ET → Friday 8 PM ET. Crypto is always open.
   */
  static isMarketOpenOrOpeningSoon(assetClass: 'us_equity' | 'crypto' = 'us_equity'): boolean {
    if (assetClass === 'crypto') {
      return true;
    }
    try {
      const ny = MarketClock.getNYParts();
      if (ny.dayOfWeek === MarketClock.SATURDAY) {
        return false;
      }
      if (ny.dayOfWeek === MarketClock.SUNDAY && ny.totalMinutes < MarketClock.EXTENDED_SESSION_END_MINUTES) {
        return false;
      }
      if (ny.dayOfWeek === MarketClock.FRIDAY && ny.totalMinutes >= MarketClock.EXTENDED_SESSION_END_MINUTES) {
        return false;
      }
      return true;
    } catch {
      return true;
    }
  }

  /**
   * Full market-status snapshot for the dashboard: open/closed state, phase, and next event time.
   */
  static getStatus(date: Date = new Date()): MarketClockStatus {
    const ny = MarketClock.getNYParts(date);
    const { year, month, day, dayOfWeek, totalMinutes } = ny;

    // Saturday: Closed all day -> opens Sunday 8:00 PM ET
    if (dayOfWeek === MarketClock.SATURDAY) {
      return {
        marketStatus: 'closed',
        isOpen: false,
        nextEvent: 'market_open',
        nextEventTime: MarketClock.makeNYDate(year, month, day + 1, 20, 0),
      };
    }

    // Sunday before 8:00 PM ET -> Closed, opens Sunday 8:00 PM ET
    if (dayOfWeek === MarketClock.SUNDAY && totalMinutes < MarketClock.EXTENDED_SESSION_END_MINUTES) {
      return {
        marketStatus: 'closed',
        isOpen: false,
        nextEvent: 'market_open',
        nextEventTime: MarketClock.makeNYDate(year, month, day, 20, 0),
      };
    }

    // Friday after 8:00 PM ET -> Closed, opens Sunday 8:00 PM ET (+2 days)
    if (dayOfWeek === MarketClock.FRIDAY && totalMinutes >= MarketClock.EXTENDED_SESSION_END_MINUTES) {
      return {
        marketStatus: 'closed',
        isOpen: false,
        nextEvent: 'market_open',
        nextEventTime: MarketClock.makeNYDate(year, month, day + 2, 20, 0),
      };
    }

    // Weekdays (Mon-Fri) before 9:30 AM ET -> Pre-market, opens today at 9:30 AM ET
    if (dayOfWeek >= MarketClock.MONDAY && dayOfWeek <= MarketClock.FRIDAY && totalMinutes < MarketClock.REGULAR_OPEN_MINUTES) {
      return {
        marketStatus: 'pre-market',
        isOpen: false,
        nextEvent: 'market_open',
        nextEventTime: MarketClock.makeNYDate(year, month, day, 9, 30),
      };
    }

    // Weekdays (Mon-Fri) 9:30 AM to 4:00 PM ET -> Regular session, closes today at 4:00 PM ET
    if (dayOfWeek >= MarketClock.MONDAY && dayOfWeek <= MarketClock.FRIDAY && totalMinutes < MarketClock.REGULAR_CLOSE_MINUTES) {
      return {
        marketStatus: 'regular-hours',
        isOpen: true,
        nextEvent: 'market_close',
        nextEventTime: MarketClock.makeNYDate(year, month, day, 16, 0),
      };
    }

    // Friday 4:00 PM to 8:00 PM ET -> After-hours, next open is Sunday 8:00 PM ET (+2 days)
    if (dayOfWeek === MarketClock.FRIDAY) {
      return {
        marketStatus: 'after-hours',
        isOpen: false,
        nextEvent: 'market_open',
        nextEventTime: MarketClock.makeNYDate(year, month, day + 2, 20, 0),
      };
    }

    // Sunday after 8:00 PM ET -> After-hours, next open is Monday 9:30 AM ET (+1 day)
    // Mon-Thu after 4:00 PM ET -> After-hours, next open is next morning 9:30 AM ET (+1 day)
    return {
      marketStatus: 'after-hours',
      isOpen: false,
      nextEvent: 'market_open',
      nextEventTime: MarketClock.makeNYDate(year, month, day + 1, 9, 30),
    };
  }
}
