"use client";

import { useState } from "react";

const videoId = process.env.NEXT_PUBLIC_YOUTUBE_VIDEO_ID || "";

export function VideoEmbed() {
  const [loaded, setLoaded] = useState(false);

  if (!videoId) {
    return (
      <div className="relative w-full aspect-video rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-[#0b0c10]">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center px-6">
            <div className="mx-auto h-14 w-14 sm:h-16 sm:w-16 rounded-full bg-white/10 flex items-center justify-center">
              <svg className="h-7 w-7 sm:h-8 sm:w-8 text-white/60 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </div>
            <p className="mt-3 text-xs sm:text-sm text-white/40 leading-relaxed">
              Set <code className="text-white/60 bg-white/5 px-1.5 py-0.5 rounded">NEXT_PUBLIC_YOUTUBE_VIDEO_ID</code> in your env<br className="hidden sm:inline" />
              and your demo video appears here, autoplaying.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full aspect-video rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-black">
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0b0c10]">
          <div className="mx-auto h-14 w-14 sm:h-16 sm:w-16 rounded-full bg-white/10 flex items-center justify-center">
            <svg className="h-7 w-7 sm:h-8 sm:w-8 text-white/60 ml-0.5 animate-pulse" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </div>
        </div>
      )}
      <iframe
        src={`https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&loop=1&rel=0&playsinline=1&controls=1&modestbranding=1`}
        allow="autoplay; encrypted-media"
        allowFullScreen
        className="absolute inset-0 w-full h-full"
        onLoad={() => setLoaded(true)}
        title="Carpa demo"
      />
    </div>
  );
}