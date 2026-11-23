import React, { useId, useState } from 'react';

export function LaDietaLogo({ size = 48 }: { size?: number }) {
  const clipId = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="39 14 306 302"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Logo La Dieta Salchipapería"
      className="shrink-0"
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="192" cy="165" r="151" />
        </clipPath>
      </defs>
      <circle cx="192" cy="165" r="151" fill="#111111" />
      <image
        href="/assets/aistudio/Men__colorido_de_La_Dieta_Salchipaper_a__1__868cef79.png"
        x="0"
        y="0"
        width="1491"
        height="1055"
        preserveAspectRatio="none"
        clipPath={`url(#${clipId})`}
      />
    </svg>
  );
}

export function DishVisual({
  imageUrl,
  categoryName,
  productName,
}: {
  imageUrl: string | null;
  categoryName: string;
  productName: string;
}) {
  const [imgFailed, setImgFailed] = useState(false);

  if (imageUrl && !imgFailed) {
    return (
      <div className="relative h-28 w-full overflow-hidden rounded-lg bg-[#161616]">
        <img
          src={imageUrl}
          alt={productName}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="h-full w-full object-cover"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
      </div>
    );
  }

  const cat = categoryName.toUpperCase();
  const isCono = cat.includes('CONO');
  const isHotDrink = cat.includes('CALIENTE');
  const isColdDrink = cat.includes('FRÍA') || cat.includes('FRIA') || cat.includes('BEBIDA');
  const isCombo = cat.includes('COMBINADO');

  return (
    <div
      className="relative flex h-28 w-full items-center justify-center overflow-hidden rounded-lg border border-[#2A2A2A]"
      style={{
        background: 'radial-gradient(circle at 35% 30%, #262218 0%, #161616 70%, #111111 100%)',
      }}
    >
      {isCono ? (
        <svg viewBox="0 0 120 90" className="h-22 w-28" fill="none" aria-hidden="true">
          <path d="M40 34 L80 34 L64 82 L56 82 Z" fill="#1E1E1E" stroke="#FFD600" strokeWidth="2.2" />
          <rect x="44" y="16" width="7" height="22" rx="2" fill="#FFD600" transform="rotate(-10 44 16)" />
          <rect x="55" y="12" width="7" height="24" rx="2" fill="#FACC15" />
          <rect x="66" y="15" width="7" height="23" rx="2" fill="#FFD600" transform="rotate(10 66 15)" />
          <circle cx="52" cy="27" r="5" fill="#E31B23" />
          <circle cx="67" cy="28" r="5" fill="#C81E1E" />
          <path d="M44 33 Q60 27 76 33" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      ) : isHotDrink ? (
        <svg viewBox="0 0 120 90" className="h-22 w-28" fill="none" aria-hidden="true">
          <path d="M36 36 H78 V60 C78 70 70 76 57 76 C44 76 36 70 36 60 Z" fill="#FFFFFF" />
          <path d="M78 42 H86 C91 42 94 46 94 51 C94 56 91 60 86 60 H78" stroke="#FFFFFF" strokeWidth="4" />
          <ellipse cx="57" cy="36" rx="21" ry="4.5" fill="#FFD600" />
          <path d="M48 26 C46 21 51 17 49 12" stroke="#FFD600" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M59 24 C57 19 62 15 60 10" stroke="#FFD600" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M70 26 C68 21 73 17 71 12" stroke="#FFD600" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      ) : isColdDrink ? (
        <svg viewBox="0 0 120 90" className="h-22 w-28" fill="none" aria-hidden="true">
          <rect x="47" y="14" width="26" height="64" rx="8" fill="#1F2937" stroke="#FFD600" strokeWidth="2" />
          <rect x="53" y="8" width="14" height="6" rx="2" fill="#E31B23" />
          <rect x="49" y="34" width="22" height="20" fill="#E31B23" />
          <circle cx="56" cy="64" r="2" fill="#FFD600" />
          <circle cx="64" cy="59" r="1.5" fill="#FFD600" />
          <circle cx="62" cy="69" r="2" fill="#FFFFFF" opacity="0.6" />
        </svg>
      ) : (
        <svg viewBox="0 0 120 90" className="h-22 w-28" fill="none" aria-hidden="true">
          <ellipse cx="60" cy="62" rx="44" ry="18" fill="#1F1F1F" stroke="#3F3F46" strokeWidth="2" />
          <rect x="33" y="34" width="7" height="24" rx="2" fill="#FFD600" transform="rotate(-18 33 34)" />
          <rect x="45" y="28" width="7" height="28" rx="2" fill="#FACC15" transform="rotate(-6 45 28)" />
          <rect x="57" y="27" width="7" height="29" rx="2" fill="#FFD600" />
          <rect x="69" y="30" width="7" height="26" rx="2" fill="#FACC15" transform="rotate(10 69 30)" />
          <rect x="78" y="36" width="7" height="22" rx="2" fill="#FFD600" transform="rotate(20 78 36)" />
          <ellipse cx="47" cy="52" rx="7" ry="4.5" fill="#E31B23" />
          <ellipse cx="62" cy="54" rx="7.5" ry="4.5" fill="#DC2626" />
          <ellipse cx="76" cy="51" rx="7" ry="4.5" fill="#E31B23" />
          {isCombo && (
            <>
              <circle cx="42" cy="40" r="8" fill="#FFFFFF" />
              <circle cx="42" cy="40" r="3.5" fill="#FFD600" />
            </>
          )}
          <path d="M36 48 Q58 41 82 49" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" opacity="0.85" />
        </svg>
      )}
    </div>
  );
}
