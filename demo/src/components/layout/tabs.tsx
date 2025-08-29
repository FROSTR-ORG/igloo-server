import { useState } from 'react'
import { Console }  from '@/demo/components/dash/console.js'
import { NodeInfo } from '@/demo/components/dash/node.js'
import { SessionsView } from '@/demo/components/sessions/sessions.js'
import { Settings } from '@/demo/components/settings/index.js'

import type { ReactElement } from 'react'

import * as Icons from '@/demo/components/util/icons.js'
import { RequestsView } from '../requests'

export function Tabs(): ReactElement {
  const [ activeTab, setActiveTab ] = useState('dashboard')

  return (
    <div className="tabs-container">
      <div className="tabs-nav-wrapper">

        <div className="tabs-navigation">
          <button 
            className={`tab-button ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <Icons.ConsoleIcon />
            <span>Dashboard</span>
          </button>

          <button 
            className={`tab-button ${activeTab === 'requests' ? 'active' : ''}`}
            onClick={() => setActiveTab('requests')}
          >
            <Icons.NodeIcon />
            <span>Requests</span>
          </button>

          <button 
            className={`tab-button ${activeTab === 'sessions' ? 'active' : ''}`}
            onClick={() => setActiveTab('sessions')}
          >
            <Icons.SessionsIcon />
            <span>Sessions</span>
          </button>

          <button
            className={`tab-button ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <Icons.SettingsIcon />
            <span>Settings</span>
          </button>
        </div>
      </div>

      <div className="tab-content">
        {activeTab === 'dashboard' && (
          <div className="tab-panel">
            <NodeInfo />
            <Console />
          </div>
        )}

        {activeTab === 'requests' && (
          <div className="tab-panel">
            <RequestsView />
          </div>
        )}

        {activeTab === 'sessions' && (
          <div className="tab-panel">
            <SessionsView />
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="tab-panel">
            <Settings />
          </div>
        )}
      </div>
    </div>
  )
}
