import React, { useState, useEffect } from 'react';
import { Users, Eye, Activity } from 'lucide-react';
import { Language } from '../types';

interface VisitorStatsCounterProps {
  lang?: Language;
}

export const VisitorStatsCounter: React.FC<VisitorStatsCounterProps> = ({ lang = 'km' }) => {
  const isKm = lang === 'km';
  const isKo = lang === 'ko';

  const [totalVisits, setTotalVisits] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('kiip_total_visits_v1');
      if (saved) {
        return Number(saved);
      }
      const initial = 14850 + Math.floor(Math.random() * 200);
      localStorage.setItem('kiip_total_visits_v1', String(initial));
      return initial;
    } catch {
      return 15024;
    }
  });

  const [liveOnline, setLiveOnline] = useState<number>(() => {
    return 32 + Math.floor(Math.random() * 25);
  });

  // Simulate live fluctuation of online users every 6 seconds
  useEffect(() => {
    const timer = window.setInterval(() => {
      setLiveOnline((prev) => {
        const delta = Math.floor(Math.random() * 5) - 2; // -2 to +2
        const next = prev + delta;
        return next < 22 ? 24 : next > 85 ? 82 : next;
      });
    }, 6000);
    return () => window.clearInterval(timer);
  }, []);

  // Increment total visits once per session
  useEffect(() => {
    try {
      const counted = sessionStorage.getItem('kiip_session_counted');
      if (!counted) {
        sessionStorage.setItem('kiip_session_counted', 'true');
        setTotalVisits((prev) => {
          const next = prev + 1;
          localStorage.setItem('kiip_total_visits_v1', String(next));
          return next;
        });
      }
    } catch {}
  }, []);

  return (
    <div className="inline-flex items-center gap-3 px-3 py-1.5 bg-slate-100/90 hover:bg-slate-200/80 rounded-full border border-slate-200 text-xs text-slate-700 shadow-2xs transition-all">
      {/* Live Online Visitors */}
      <div className="flex items-center gap-1.5" title={isKm ? 'អ្នកកំពុងប្រើប្រាស់ផ្ទាល់ឥឡូវនេះ' : 'Live online visitors now'}>
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

      {/* Total Visitors */}
      <div className="flex items-center gap-1.5" title={isKm ? 'ចំនួនអ្នកចូលទស្សនាសរុប' : 'Total website visits'}>
        <Eye className="w-3.5 h-3.5 text-blue-600 shrink-0" />
        <span className="font-bold text-slate-900 tabular-nums">{totalVisits.toLocaleString()}</span>
        <span className="text-[11px] text-slate-500 hidden sm:inline">
          {isKm ? 'នាក់ចូលមើលសរុប' : isKo ? '전체 방문자' : 'total views'}
        </span>
      </div>
    </div>
  );
};
