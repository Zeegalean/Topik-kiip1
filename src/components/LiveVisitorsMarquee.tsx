import React, { useEffect, useState, useCallback } from 'react';
import { Globe, MapPin, ShieldCheck, Radio, RefreshCw, EyeOff, Eye, Users } from 'lucide-react';
import { Language } from '../types';

export interface LiveVisitorRecord {
  sessionId: string;
  maskedIp: string;
  city: string;
  region: string;
  country: string;
  countryCode: string;
  lastSeen: string;
  firstSeen: string;
  page: string;
  isLive: boolean;
}

export interface LiveVisitorsPayload {
  liveCount: number;
  totalVisits: number;
  visitors: LiveVisitorRecord[];
  cityBreakdown: { cityLabel: string; count: number }[];
}

interface LiveVisitorsMarqueeProps {
  adminToken: string | null;
  lang?: Language;
  mode?: 'marquee' | 'panel';
  onStatsUpdate?: (payload: LiveVisitorsPayload) => void;
}

export const LiveVisitorsMarquee: React.FC<LiveVisitorsMarqueeProps> = ({
  adminToken,
  lang = 'km',
  mode = 'marquee',
  onStatsUpdate,
}) => {
  const isKm = lang === 'km';
  const [data, setData] = useState<LiveVisitorsPayload>({
    liveCount: 0,
    totalVisits: 0,
    visitors: [],
    cityBreakdown: [],
  });
  const [loading, setLoading] = useState(false);
  const [showMaskedIp, setShowMaskedIp] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<string>('');

  const fetchLiveVisitors = useCallback(async () => {
    setLoading(true);
    try {
      if (adminToken) {
        const resp = await fetch('/api/admin/live-visitors', {
          headers: { Authorization: `Bearer ${adminToken}` },
        });
        if (resp.ok) {
          const json = await resp.json();
          if (json?.success) {
            const payload: LiveVisitorsPayload = {
              liveCount: Number(json.liveCount) || 0,
              totalVisits: Number(json.totalVisits) || 0,
              visitors: Array.isArray(json.visitors) ? json.visitors : [],
              cityBreakdown: Array.isArray(json.cityBreakdown) ? json.cityBreakdown : [],
            };
            setData(payload);
            onStatsUpdate?.(payload);
            setLastRefreshed(new Date().toLocaleTimeString());
            return;
          }
        }
      }

      // Fallback to public city-only stats if admin Bearer session isn't active (e.g. Google-only admin)
      const pubResp = await fetch('/api/visitors/public-stats');
      if (pubResp.ok) {
        const pub = await pubResp.json();
        if (pub?.success) {
          const mappedVisitors: LiveVisitorRecord[] = (pub.liveCities || []).map(
            (c: any, idx: number) => ({
              sessionId: `pub_${idx}`,
              maskedIp: '***.***.***.***',
              city: c.city || 'Unknown City',
              region: '',
              country: c.country || '',
              countryCode: c.countryCode || '',
              lastSeen: new Date().toISOString(),
              firstSeen: new Date().toISOString(),
              page: '/',
              isLive: Boolean(c.isLive),
            })
          );
          const payload: LiveVisitorsPayload = {
            liveCount: Number(pub.liveCount) || 0,
            totalVisits: Number(pub.totalVisits) || 0,
            visitors: mappedVisitors,
            cityBreakdown: [],
          };
          setData(payload);
          onStatsUpdate?.(payload);
          setLastRefreshed(new Date().toLocaleTimeString());
        }
      }
    } catch {
      // Keep last known real state
    } finally {
      setLoading(false);
    }
  }, [adminToken, onStatsUpdate]);

  useEffect(() => {
    fetchLiveVisitors();
    const timer = window.setInterval(fetchLiveVisitors, 15000);
    return () => window.clearInterval(timer);
  }, [fetchLiveVisitors]);

  if (mode === 'panel') {
    return (
      <div className="space-y-5 animate-in fade-in duration-200">
        {/* Top Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-1.5">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-bold uppercase tracking-wider">
                {isKm ? 'អ្នកកំពុងមើលផ្ទាល់ (Live)' : 'Live Active Visitors'}
              </span>
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
            </div>
            <div className="text-2xl font-black text-emerald-700 tabular-nums">
              {data.liveCount}
            </div>
            <p className="text-[11px] text-slate-500">
              {isKm ? 'សកម្មក្នុងរយៈពេល ៥ នាទីចុងក្រោយ' : 'Active within last 5 minutes'}
            </p>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-1.5">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-bold uppercase tracking-wider">
                {isKm ? 'សម័យកាលចូលមើលសរុប' : 'Real Session Visits'}
              </span>
              <Users className="w-5 h-5 text-blue-600" />
            </div>
            <div className="text-2xl font-black text-slate-900 tabular-nums">
              {data.totalVisits}
            </div>
            <p className="text-[11px] text-slate-500">
              {isKm ? 'ទិន្នន័យពិតពី IP-to-Location API' : 'Real unique sessions tracked'}
            </p>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-1.5">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-bold uppercase tracking-wider">
                {isKm ? 'ទីក្រុងសកម្ម' : 'Unique Cities'}
              </span>
              <Globe className="w-5 h-5 text-indigo-600" />
            </div>
            <div className="text-2xl font-black text-indigo-700 tabular-nums">
              {data.cityBreakdown.length}
            </div>
            <p className="text-[11px] text-slate-500 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>{isKm ? 'លេខ IP ត្រូវបានលាក់ដោយសុវត្ថិភាព' : 'IP digits masked for privacy'}</span>
            </p>
          </div>
        </div>

        {/* City Breakdown */}
        {data.cityBreakdown.length > 0 && (
          <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs space-y-3">
            <h4 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
              <MapPin className="w-4 h-4 text-rose-500" />
              <span>{isKm ? 'ចំនួនអ្នកចូលទស្សនាតាមទីក្រុង (City Distribution)' : 'Visitors by City'}</span>
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
              {data.cityBreakdown.map((item) => (
                <div
                  key={item.cityLabel}
                  className="px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs"
                >
                  <span className="font-bold text-slate-800 truncate">{item.cityLabel}</span>
                  <span className="font-black text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md tabular-nums">
                    {item.count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Live Visitors Table */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-emerald-600" />
              <h4 className="font-extrabold text-slate-900 text-sm">
                {isKm ? 'បញ្ជីអ្នកកំពុងទស្សនាផ្ទាល់ (IP-to-City)' : 'Live Visitors Feed (Masked IPs)'}
              </h4>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowMaskedIp((v) => !v)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-[11px] font-bold text-slate-700 inline-flex items-center gap-1 cursor-pointer"
              >
                {showMaskedIp ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{showMaskedIp ? (isKm ? 'លាក់ IP ទាំងស្រុង' : 'City Only') : (isKm ? 'បង្ហាញ Masked IP' : 'Show Masked IP')}</span>
              </button>
              <button
                type="button"
                onClick={fetchLiveVisitors}
                disabled={loading}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-bold text-slate-700 inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>{lastRefreshed || 'Refresh'}</span>
              </button>
            </div>
          </div>

          {data.visitors.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              {isKm
                ? 'មិនទាន់មានសម័យកាលអ្នកទស្សនាថ្មីទេ។ ទិន្នន័យពិតនឹងបង្ហាញភ្លាមៗពេលមានអ្នកចូលប្រើប្រាស់។'
                : 'No active visitor sessions recorded yet. Real visitors will appear here automatically.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500 font-bold">
                    <th className="p-3.5">{isKm ? 'ស្ថានភាព' : 'Status'}</th>
                    <th className="p-3.5">{isKm ? 'ទីក្រុង / ប្រទេស' : 'City / Country'}</th>
                    {showMaskedIp && <th className="p-3.5">{isKm ? 'Masked IP (លាក់លេខ)' : 'Masked IP'}</th>}
                    <th className="p-3.5">{isKm ? 'សកម្មភាពចុងក្រោយ' : 'Last Seen'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs font-semibold text-slate-800">
                  {data.visitors.map((v) => (
                    <tr key={v.sessionId} className="hover:bg-slate-50/80">
                      <td className="p-3.5">
                        {v.isLive ? (
                          <span className="inline-flex items-center gap-1.5 text-emerald-700 font-bold">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                            <span>LIVE</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-slate-400 font-bold">
                            <span className="w-2 h-2 rounded-full bg-slate-300" />
                            <span>Recent</span>
                          </span>
                        )}
                      </td>
                      <td className="p-3.5">
                        <span className="inline-flex items-center gap-1.5 font-bold text-slate-900">
                          <MapPin className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                          <span>
                            {v.city}
                            {v.country ? `, ${v.country}` : ''}
                          </span>
                        </span>
                      </td>
                      {showMaskedIp && (
                        <td className="p-3.5 font-mono text-slate-600">{v.maskedIp}</td>
                      )}
                      <td className="p-3.5 tabular-nums text-slate-500">
                        {new Date(v.lastSeen).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Bottom Dashboard Scrolling Right-to-Left Marquee Bar
  const marqueeItems =
    data.visitors.length > 0
      ? data.visitors
      : [
          {
            sessionId: 'waiting',
            maskedIp: '***.***.***.***',
            city: isKm ? 'កំពុងរង់ចាំអ្នកទស្សនាផ្ទាល់...' : 'Listening for live visitors...',
            region: '',
            country: '',
            countryCode: '',
            lastSeen: new Date().toISOString(),
            firstSeen: new Date().toISOString(),
            page: '/',
            isLive: true,
          },
        ];

  return (
    <div className="shrink-0 bg-slate-950 text-slate-100 border-t border-slate-800 px-3 sm:px-4 py-2.5 flex items-center gap-3 overflow-hidden">
      {/* Left Fixed Live Badge */}
      <div className="shrink-0 flex items-center gap-2 pr-3 border-r border-slate-800">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
        </span>
        <span className="text-[11px] font-black uppercase tracking-wider text-emerald-400 whitespace-nowrap">
          {isKm ? `ផ្ទាល់ (${data.liveCount})` : `LIVE (${data.liveCount})`}
        </span>
        <button
          type="button"
          onClick={() => setShowMaskedIp((v) => !v)}
          title={showMaskedIp ? 'Hide masked IP digits' : 'Show masked IP digits'}
          className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 cursor-pointer"
        >
          {showMaskedIp ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          <span>{showMaskedIp ? 'IP Masked' : 'City Only'}</span>
        </button>
      </div>

      {/* Right-to-Left Scrolling Cities Marquee */}
      <div className="flex-1 overflow-hidden relative">
        <div className="animate-marquee-rtl items-center gap-6">
          {[...marqueeItems, ...marqueeItems].map((v, idx) => (
            <span
              key={`${v.sessionId}-${idx}`}
              className="inline-flex items-center gap-2 text-xs whitespace-nowrap"
            >
              <MapPin className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              <span className="font-bold text-white">
                {v.city}
                {v.countryCode ? ` (${v.countryCode})` : v.country ? `, ${v.country}` : ''}
              </span>
              {showMaskedIp && v.sessionId !== 'waiting' && (
                <span className="font-mono text-[11px] text-slate-400 bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded">
                  {v.maskedIp}
                </span>
              )}
              <span className="text-slate-700 mx-1">•</span>
            </span>
          ))}
        </div>
      </div>

      {/* Right Total Counter */}
      <div className="hidden md:flex shrink-0 items-center gap-1.5 pl-3 border-l border-slate-800 text-[11px] text-slate-400 tabular-nums">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
        <span>
          {isKm ? `សរុប ${data.totalVisits}` : `Total ${data.totalVisits}`}
        </span>
      </div>
    </div>
  );
};
