import React from 'react';
import { cn } from "../../lib/utils";

interface PageLayoutProps {
  children: React.ReactNode;
  className?: string;
  maxWidth?: string;
}

export function PageLayout({ 
  children, 
  className, 
  maxWidth = "max-w-3xl" 
}: PageLayoutProps) {
  // Create a mapping of responsive classes
  const maxWidthClasses = {
    "max-w-3xl": "max-w-none sm:max-w-3xl",
    "max-w-4xl": "max-w-none sm:max-w-4xl", 
    "max-w-5xl": "max-w-none sm:max-w-5xl",
    "max-w-6xl": "max-w-none sm:max-w-6xl",
    "max-w-7xl": "max-w-none sm:max-w-7xl",
    "max-w-full": "max-w-none sm:max-w-full"
  };

  const responsiveClass = maxWidthClasses[maxWidth as keyof typeof maxWidthClasses] || "max-w-none sm:max-w-3xl";

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 to-blue-950 text-blue-100 p-4 sm:p-8 flex flex-col items-center">
      {/* Full width on mobile, constrained on sm+ */}
      <div className={cn("w-full", responsiveClass, className)}>
        {children}
      </div>
    </div>
  );
} 