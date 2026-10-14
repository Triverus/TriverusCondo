import React from 'react';
import { motion, AnimatePresence } from 'motion/react';

export interface LoaderProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function Loader({
  title,
  subtitle,
  size = 'md',
  className = '',
}: LoaderProps) {
  const sizeMap = {
    sm: {
      container: 'w-10 h-10',
      ring: 'w-6 h-6 border-2',
      innerDot: 'w-1.5 h-1.5',
      title: 'text-sm font-semibold',
      subtitle: 'text-[11px]',
      gap: 'space-y-1',
    },
    md: {
      container: 'w-14 h-14',
      ring: 'w-8 h-8 border-[2.5px]',
      innerDot: 'w-2 h-2',
      title: 'text-base font-bold',
      subtitle: 'text-xs',
      gap: 'space-y-1.5',
    },
    lg: {
      container: 'w-20 h-20',
      ring: 'w-12 h-12 border-3',
      innerDot: 'w-3 h-3',
      title: 'text-lg font-bold',
      subtitle: 'text-sm',
      gap: 'space-y-2',
    },
  }[size];

  return (
    <div className={`flex flex-col items-center justify-center text-center ${className}`}>
      {/* Outer Glow & Animated Spinner Ring */}
      <div className="relative flex items-center justify-center">
        {/* Subtle breathing glow */}
        <motion.div
          animate={{
            scale: [1, 1.15, 1],
            opacity: [0.15, 0.35, 0.15],
          }}
          transition={{
            duration: 2.4,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
          className={`absolute rounded-full bg-indigo-500 blur-lg ${sizeMap.container}`}
        />

        {/* Icon Frame */}
        <div
          className={`${sizeMap.container} rounded-2xl bg-indigo-950/60 text-indigo-400 border border-indigo-500/30 shadow-lg shadow-indigo-950/50 flex items-center justify-center relative overflow-hidden backdrop-blur-xs`}
        >
          {/* Rotating Arc Ring */}
          <motion.div
            animate={{ rotate: 360 }}
            transition={{
              duration: 1,
              repeat: Infinity,
              ease: 'linear',
            }}
            className={`rounded-full border-indigo-500/20 border-t-indigo-400 border-r-indigo-400/80 ${sizeMap.ring}`}
          />

          {/* Central Pulsing Dot */}
          <motion.div
            animate={{
              scale: [0.8, 1.2, 0.8],
              opacity: [0.6, 1, 0.6],
            }}
            transition={{
              duration: 1.6,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            className={`absolute rounded-full bg-indigo-400 shadow-sm shadow-indigo-400 ${sizeMap.innerDot}`}
          />
        </div>
      </div>

      {/* Semantic Title & Subtitle with smooth transitions */}
      {(title || subtitle) && (
        <div className={`mt-4 max-w-xs ${sizeMap.gap}`}>
          <AnimatePresence mode="wait">
            {title && (
              <motion.h3
                key={typeof title === 'string' ? title : 'loader-title'}
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.18 }}
                className={`${sizeMap.title} text-white tracking-tight`}
              >
                {title}
              </motion.h3>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait">
            {subtitle && (
              <motion.p
                key={typeof subtitle === 'string' ? subtitle : 'loader-sub'}
                initial={{ opacity: 0, y: 2 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -2 }}
                transition={{ duration: 0.18 }}
                className={`${sizeMap.subtitle} text-slate-400 leading-relaxed`}
              >
                {subtitle}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

export default Loader;
