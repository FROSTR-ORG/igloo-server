import React from 'react';
import { Button } from './ui/button';
import { ArrowRight, Server, ExternalLink } from 'lucide-react';

interface OnboardingInstructionsProps {
  onContinue: () => void;
}

export const OnboardingInstructions: React.FC<OnboardingInstructionsProps> = ({ onContinue }) => {
  return (
    <div className="space-y-6">
      {/* Hero Section */}
      <div className="text-center space-y-3">
        <div className="flex items-center justify-center">
          <div className="p-3 bg-blue-600/10 rounded-xl border border-blue-600/20">
            <Server className="w-8 h-8 text-blue-400" />
          </div>
        </div>
        <h2 className="text-xl font-semibold text-blue-200">
          Welcome to Igloo Server
        </h2>
        <p className="text-sm text-blue-300/70 max-w-sm mx-auto">
          An always-on threshold signing node for the FROSTR protocol
        </p>
      </div>

      {/* About */}
      <div className="bg-gray-800/30 border border-blue-900/30 rounded-lg p-4 space-y-2">
        <p className="text-sm text-blue-100/80 leading-relaxed">
          Igloo Server runs as a remote signer for your Nostr private key using FROSTR threshold signatures.
          Your private key is split into shares, and signing requires multiple shares to cooperate.
          The full key is never reconstructed.
        </p>
      </div>

      {/* Before You Start */}
      <div className="bg-amber-900/20 border border-amber-700/30 rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-semibold text-amber-200">Before You Start</h3>
        <p className="text-sm text-amber-100/80 leading-relaxed">
          You'll need a <span className="font-medium text-amber-200">FROSTR keyset</span> (group credential + share credential) to configure this server.
          Generate one using Igloo Desktop or CLI, then bring a share here.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <a
            href="https://github.com/FROSTR-ORG/igloo-desktop/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-600/30 rounded text-blue-300 text-xs transition-colors"
          >
            Igloo Desktop
            <ExternalLink className="w-3 h-3" />
          </a>
          <a
            href="https://www.npmjs.com/package/@frostr/igloo-core"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-600/30 rounded text-blue-300 text-xs transition-colors"
          >
            Igloo CLI
            <ExternalLink className="w-3 h-3" />
          </a>
          <a
            href="https://frostr.org/apps"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-600/30 rounded text-blue-300 text-xs transition-colors"
          >
            All FROSTR Apps
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* Continue Button */}
      <Button
        onClick={onContinue}
        className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
      >
        <span className="flex items-center justify-center">
          Continue to Setup
          <ArrowRight className="ml-2 h-5 w-5" />
        </span>
      </Button>
    </div>
  );
};

export default OnboardingInstructions;
