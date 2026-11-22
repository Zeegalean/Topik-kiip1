import React, { useState, useEffect } from 'react';
import { Eye, MapPin } from 'lucide-react';
import { Language } from '../types';

interface VisitorStatsCounterProps {
  lang?: Language;
}

interface PublicCityItem {
  city: string;
  country: string;
  countryCode: string;
  isLive: boolean;
}

function getOrCreateSessionId(): string {
  try {
    const existing = sessionStorage.getItem('kiip_real_visitor_sid');
    if (existing && /^[a-zA-Z0-9_-]{4,64}$/.test(existing)) return existing;
    const next = `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem('kiip_real_visitor_sid', next);
    return next;
  } catch {
    return `v_${Date.now().toString(36)}`;
  }
}

export const VisitorStatsCounter: React.FC<VisitorStatsCounterProps> = ({ lang = 'km' }) => {
  const isKm = lang === 'km';
  const isKo = lang === 'ko';

  const [liveOnline, setLiveOnline] = useState<number>(1);
  const [totalVisits, setTotalVisits] = useState<number>(1);
  const [liveCities, setLiveCities] = useState<PublicCityItem[]>([]);

  useEffect(() => {
    let active = true;
    const sessionId = getOrCreateSessionId();

    const sendHeartbeatAndFetch = async () => {
      try {
        await fetch('/api/visitors/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            page: window.location.pathname || '/',
          }),
        });
      } catch {
        // Ignore transient network errors
      }

      try {
        const resp = await fetch('/api/visitors/public-stats');
        if (!resp.ok) return;
        const data = await resp.json();
        if (active && data?.success) {
          setLiveOnline(Math.max(1, Number(data.liveCount) || 1));
          setTotalVisits(Math.max(1, Number(data.totalVisits) || 1));
          if (Array.isArray(data.liveCities)) {
            setLiveCities(data.liveCities);
          }
        }
      } catch {
        // Ignore transient network errors
      }
    };

    sendHeartbeatAndFetch();
    const timer = window.setInterval(sendHeartbeatAndFetch, 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const uniqueCities = liveCities.filter(
    (item, idx, arr) =>
      item.city &&
      arr.findIndex((other) => other.city === item.city && other.countryCode === item.countryCode) === idx
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Real Live Online & Total Visits Pill */}
      <div className="inline-flex items-center gap-3 px-3 py-1.5 bg-slate-100/90 hover:bg-slate-200/80 rounded-full border border-slate-200 text-xs text-slate-700 shadow-2xs transition-all">
        <div className="flex items-center gap-1.5" title={isKm ? 'អ្នកកំពុងប្រើប្រាស់ផ្ទាល់ឥឡូវនេះ (ទិន្នន័យពិត)' : 'Real live online visitors now'}>
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="font-bold text-emerald-800 tabular-nums">{liveOnline}</span>
          <span className="text-[11px] text-slate-500 hidden sm:inline">
            {isKm ? 'នាក់កំពុងមើល' : isKo ? '명 접속중' : 'online'}
          </span>
        </div>

        <span className="text-slate-300">|</span>

        <div className="flex items-center gap-1.5" title={isKm ? 'ចំនួនអ្នកចូលទស្សនាពិតសរុប' : 'Real total website visits'}>
          <Eye className="w-3.5 h-3.5 text-blue-600 shrink-0" />
          <span className="font-bold text-slate-900 tabular-nums">{totalVisits.toLocaleString()}</span>
          <span className="text-[11px] text-slate-500 hidden sm:inline">
            {isKm ? 'នាក់ចូលមើលសរុប' : isKo ? '전체 방문자' : 'total views'}
          </span>
        </div>
      </div>

      {/* Right-to-Left Scrolling City Ticker (IP completely hidden for user privacy) */}
      {uniqueCities.length > 0 && (
        <div
          className="inline-flex items-center gap-1.5 max-w-[240px] sm:max-w-[300px] px-2.5 py-1 bg-slate-900 text-slate-100 rounded-full border border-slate-700 overflow-hidden"
          title={isKm ? 'ទីក្រុងអ្នកកំពុងចូលទស្សនាផ្ទាល់ (លាក់ IP ដើម្បីឯកជនភាព)' : 'Live visitor cities (IPs hidden for privacy)'}
        >
          <MapPin className="w-3 h-3 text-rose-400 shrink-0" />
          <div className="overflow-hidden flex-1">
            <div className="animate-marquee-rtl items-center gap-4 text-[11px]">
              {[...uniqueCities, ...uniqueCities].map((c, idx) => (
                <span key={`${c.city}-${idx}`} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span className="font-semibold text-white">
                    {c.city}
                    {c.countryCode ? ` (${c.countryCode})` : ''}
                  </span>
                  <span className="text-slate-500">•</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
