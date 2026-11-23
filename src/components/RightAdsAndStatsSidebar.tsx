import React, { useState, useEffect } from 'react';
import { Eye, MapPin, Radio, Users, Megaphone, ExternalLink } from 'lucide-react';
import { Language } from '../types';

interface RightAdsAndStatsSidebarProps {
  lang?: Language;
}

interface PublicCityItem {
  city: string;
  country: string;
  countryCode: string;
  isLive: boolean;
}

const CONTACT_ADS_FB_URL = 'https://www.facebook.com/eang.veasna.667/';

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

export const RightAdsAndStatsSidebar: React.FC<RightAdsAndStatsSidebarProps> = ({ lang = 'km' }) => {
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
    <aside
      aria-label={isKm ? 'ស្ថិតិអ្នកទស្សនា និង ផ្ទាំងពាណិជ្ជកម្ម' : 'Live Visitor Stats and Advertisement'}
      className="w-full lg:w-[324px] shrink-0 space-y-4 lg:sticky lg:top-20 no-print"
    >
      {/* 1. Live Viewer Stats & Total Visitors Card */}
      <div className="bg-white/95 backdrop-blur-xs rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-950 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-emerald-400 shrink-0" />
            <h3 className="text-xs font-black tracking-wide">
              {isKm
                ? 'ស្ថិតិអ្នកចូលទស្សនា (Live Stats)'
                : isKo
                ? '실시간 방문자 통계'
                : 'Live Visitor Statistics'}
            </h3>
          </div>
          <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-emerald-300">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span>LIVE</span>
          </span>
        </div>

        <div className="p-3.5 space-y-3">
          {/* Two Clear Static Metric Boxes: Live Online + Already Visited Total */}
          <div className="grid grid-cols-2 gap-2.5">
            {/* Live Viewers Online Now */}
            <div className="p-3 rounded-xl bg-emerald-50/90 border border-emerald-200/80 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10.5px] font-bold text-emerald-800">
                  {isKm ? 'កំពុងមើលផ្ទាល់' : isKo ? '현재 접속중' : 'Live Viewers'}
                </span>
                <Users className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              </div>
              <p className="text-2xl font-black text-emerald-900 tabular-nums leading-none pt-0.5">
                {liveOnline.toLocaleString()}
              </p>
              <p className="text-[10px] font-semibold text-emerald-700/90">
                {isKm ? 'នាក់កំពុងប្រើប្រាស់' : isKo ? '명 온라인' : 'online now'}
              </p>
            </div>

            {/* Total Already Visited */}
            <div className="p-3 rounded-xl bg-sky-50/90 border border-sky-200/80 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10.5px] font-bold text-sky-900">
                  {isKm ? 'បានចូលទស្សនា' : isKo ? '누적 방문자' : 'Total Visited'}
                </span>
                <Eye className="w-3.5 h-3.5 text-sky-600 shrink-0" />
              </div>
              <p className="text-2xl font-black text-slate-900 tabular-nums leading-none pt-0.5">
                {totalVisits.toLocaleString()}
              </p>
              <p className="text-[10px] font-semibold text-sky-700/90">
                {isKm ? 'នាក់បានចូលរួចហើយ' : isKo ? '명 방문 완료' : 'total visits'}
              </p>
            </div>
          </div>

          {/* Live Visitor Cities Ticker (IP completely hidden for privacy) */}
          {uniqueCities.length > 0 && (
            <div
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-900 text-slate-100 rounded-xl border border-slate-800 overflow-hidden"
              title={
                isKm
                  ? 'ទីក្រុងអ្នកកំពុងចូលទស្សនាផ្ទាល់ (លាក់ IP ដើម្បីឯកជនភាព)'
                  : 'Live visitor cities (IPs hidden for privacy)'
              }
            >
              <MapPin className="w-3.5 h-3.5 text-rose-400 shrink-0" />
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
      </div>

      {/* 2. Reserved 300 × 250 Advertisement Slot (Standard IAB Medium Rectangle) */}
      <div className="bg-white/95 backdrop-blur-xs rounded-2xl border border-slate-200 shadow-sm p-3 flex flex-col items-center gap-2">
        <div className="w-full flex items-center justify-between px-0.5">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            {isKm ? 'ពាណិជ្ជកម្ម · ADS' : 'ADVERTISEMENT'}
          </span>
          <span className="text-[10px] font-mono font-bold text-slate-400 tabular-nums">
            300 × 250
          </span>
        </div>

        {/* Exact 300x250 Ad Container (Ready for Google AdSense / Custom Sponsor Banner) */}
        <div
          id="ad-slot-right-300x250"
          data-ad-size="300x250"
          className="w-[300px] max-w-full h-[250px] rounded-xl border-2 border-dashed border-slate-300 bg-gradient-to-br from-slate-50 via-white to-indigo-50/60 flex flex-col items-center justify-center p-5 text-center gap-2.5 overflow-hidden"
        >
          <div className="w-11 h-11 rounded-2xl bg-indigo-100 text-indigo-600 flex items-center justify-center shadow-2xs">
            <Megaphone className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-black text-slate-800 tracking-wide">
              {isKm ? 'ទីតាំងដាក់ពាណិជ្ជកម្ម (300 × 250)' : isKo ? '광고 배너 영역 (300 × 250)' : 'Ad Space · 300 × 250'}
            </p>
            <p className="text-[11px] text-slate-500 leading-relaxed max-w-[230px]">
              {isKm
                ? 'រៀបចំទុកសម្រាប់ Google AdSense ឬ Banner ផ្សព្វផ្សាយពាណិជ្ជកម្មរបស់អ្នក'
                : isKo
                ? 'Google AdSense 또는 스폰서 배너(300×250) 게재 가능 공간'
                : 'Reserved Medium Rectangle slot for Google AdSense or sponsor banner'}
            </p>
          </div>
          <a
            href={CONTACT_ADS_FB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-indigo-700 text-white text-[11px] font-bold inline-flex items-center gap-1.5 transition-colors shadow-2xs"
          >
            <span>{isKm ? 'ទាក់ទងដាក់ពាណិជ្ជកម្ម' : isKo ? '광고 문의하기' : 'Advertise Here'}</span>
            <ExternalLink className="w-3 h-3 opacity-80" />
          </a>
        </div>
      </div>
    </aside>
  );
};
