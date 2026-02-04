import React from 'react';
import { Alert } from './alert';
import { Button } from './button';
import { cn } from '../../lib/utils';
import type { UpdateInfo } from '../../types';

interface UpdateBannerProps {
  info?: UpdateInfo | null;
  className?: string;
}

export const UpdateBanner: React.FC<UpdateBannerProps> = ({ info, className }) => {
  if (!info || !info.enabled || !info.updateAvailable || !info.latestVersion) {
    return null;
  }

  return (
    <Alert
      variant="info"
      title="Update available"
      className={cn('mb-6', className)}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="text-sm">
          You are on v{info.currentVersion}. Latest is v{info.latestVersion}.
        </div>
        {info.releaseUrl && (
          <Button asChild size="sm" variant="secondary">
            <a href={info.releaseUrl} target="_blank" rel="noopener noreferrer">
              View release
            </a>
          </Button>
        )}
      </div>
    </Alert>
  );
};
