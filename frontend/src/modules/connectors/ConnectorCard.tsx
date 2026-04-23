import React, { useState } from 'react';
import {
  Globe, Code2, Zap, Building2, Users, Cloud, Database,
  FileText, FileSearch, Table, Activity, Webhook, Layers, Snowflake, Trash2,
  GitBranch, MessageCircle, Mic, PackageOpen
} from 'lucide-react';
import { ConnectorConfig } from '../../types/connector';
import { Badge } from '../../design-system/components/Badge';
import { StatusDot } from '../../design-system/components/StatusDot';
import { categoryColors } from '../../design-system/tokens';

const ICON_MAP: Record<string, React.ReactNode> = {
  Globe: <Globe size={24} />,
  Code2: <Code2 size={24} />,
  Zap: <Zap size={24} />,
  Building2: <Building2 size={24} />,
  Users: <Users size={24} />,
  Cloud: <Cloud size={24} />,
  Database: <Database size={24} />,
  FileText: <FileText size={24} />,
  FileSearch: <FileSearch size={24} />,
  Table: <Table size={24} />,
  Activity: <Activity size={24} />,
  Webhook: <Webhook size={24} />,
  Layers: <Layers size={24} />,
  Snowflake: <Snowflake size={24} />,
  GitBranch: <GitBranch size={24} />,
  MessageCircle: <MessageCircle size={24} />,
  Mic: <Mic size={24} />,
  PackageOpen: <PackageOpen size={24} />,
};

interface ConnectorCardProps {
  connector: ConnectorConfig;
  iconName: string;
  onClick: (connector: ConnectorConfig) => void;
  onDelete?: (connector: ConnectorConfig) => void;
  selected?: boolean;
}

export const ConnectorCard: React.FC<ConnectorCardProps> = ({
  connector,
  iconName,
  onClick,
  onDelete,
  selected = false,
}) => {
  const [hovered, setHovered] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const catColor = categoryColors[connector.category] || { bg: '#F1F5F9', text: '#475569' };
  const iconColor = catColor.text;

  const formatLastSync = (ts?: string): string => {
    if (!ts) return 'Never';
    const d = new Date(ts);
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div
      onClick={() => onClick(connector)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        backgroundColor: hovered ? '#F8F9FA' : '#FFFFFF',
        border: `1px solid ${selected ? '#2563EB' : hovered ? '#CBD5E1' : '#E2E8F0'}`,
        borderRadius: '4px',
        cursor: 'pointer',
        transition: 'border-color 80ms ease-out, background-color 80ms ease-out',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* Top section */}
      <div style={{
        padding: '16px 16px 12px',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '8px',
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: '4px',
          backgroundColor: catColor.bg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: iconColor, flexShrink: 0,
        }}>
          {ICON_MAP[iconName] || <Globe size={24} />}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', marginLeft: 'auto' }}>
          <Badge label={connector.category} variant="category" size="sm" />
          {onDelete && (hovered || confirmDelete) && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirmDelete) {
                  onDelete(connector);
                } else {
                  setConfirmDelete(true);
                  setTimeout(() => setConfirmDelete(false), 2500);
                }
              }}
              title={confirmDelete ? 'Click again to confirm delete' : 'Delete connector'}
              style={{
                width: 22, height: 22, borderRadius: '3px', flexShrink: 0,
                border: `1px solid ${confirmDelete ? '#FCA5A5' : '#E2E8F0'}`,
                backgroundColor: confirmDelete ? '#FEF2F2' : '#FFFFFF',
                color: confirmDelete ? '#DC2626' : '#94A3B8',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', transition: 'all 80ms',
              }}
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Middle: name + description */}
      <div style={{ padding: '0 16px 12px', flex: 1 }}>
        <div style={{
          fontSize: '14px',
          fontWeight: 600,
          color: '#0D1117',
          marginBottom: '4px',
          lineHeight: '20px',
        }}>
          {connector.name}
        </div>
        <div style={{
          fontSize: '12px',
          color: '#64748B',
          lineHeight: '16px',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {connector.description || `Connect to ${connector.name} data source`}
        </div>
      </div>

      {/* Bottom strip */}
      <div style={{
        borderTop: '1px solid #E2E8F0',
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        backgroundColor: '#FAFAFA',
      }}>
        <span style={{ fontSize: '11px', color: '#64748B', whiteSpace: 'nowrap' }}>
          <span style={{ color: '#0D1117', fontWeight: 500 }}>{connector.activePipelineCount}</span> pipelines
        </span>
        <span style={{ color: '#CBD5E1', fontSize: '11px' }}>|</span>
        <span style={{ fontSize: '11px', color: '#64748B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {formatLastSync(connector.lastSync)}
        </span>
        <span style={{ color: '#CBD5E1', fontSize: '11px' }}>|</span>
        <StatusDot status={connector.status} size={8} />
      </div>
    </div>
  );
};

export default ConnectorCard;
