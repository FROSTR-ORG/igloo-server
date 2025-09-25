import React from 'react'
import { cn } from '../../lib/utils'

interface SpinnerProps {
  label?: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
  labelClassName?: string
  inline?: boolean
}

const sizeMap = {
  sm: { circle: 'h-4 w-4 border-2', gap: 'gap-2', text: 'text-xs' },
  md: { circle: 'h-6 w-6 border-2', gap: 'gap-3', text: 'text-sm' },
  lg: { circle: 'h-8 w-8 border-4', gap: 'gap-4', text: 'text-base' },
}

export const Spinner: React.FC<SpinnerProps> = ({ label, size = 'md', className, labelClassName, inline = false }) => {
  const s = sizeMap[size]
  const content = (
    <div className={cn('flex items-center', s.gap, className)}>
      <div className={cn(
        'rounded-full animate-spin',
        'border-blue-900/40 border-t-blue-400',
        s.circle,
      )} />
      {label && (
        <span className={cn('text-blue-300', s.text, labelClassName)}>{label}</span>
      )}
    </div>
  )

  if (inline) return content
  return (
    <div className="w-full flex items-center justify-center py-8">
      {content}
    </div>
  )
}

export default Spinner

