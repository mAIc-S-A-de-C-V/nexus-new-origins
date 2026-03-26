import React, { useState, useEffect } from 'react';
import { Plus, Search } from 'lucide-react';
import { ConnectorCard } from './ConnectorCard';
import { ConnectorDetailPanel } from './ConnectorDetailPanel';
import { AddConnectorModal } from './AddConnectorModal';
import { PostmanConnectorModal } from './PostmanConnectorModal';
import { ConnectorConfig } from '../../types/connector';
import { CONNECTOR_TYPES, ConnectorTypeDefinition } from './connectorTypes';
import { useConnectorStore } from '../../store/connectorStore';
import { Button } from '../../design-system/components/Button';

export const ConnectorGrid: React.FC = () => {
  const { connectors, fetchConnectors, removeConnector } = useConnectorStore();

  useEffect(() => {
    fetchConnectors();
  }, []);
  const [selectedConnector, setSelectedConnector] = useState<ConnectorConfig | null>(null);
  const [addingType, setAddingType] = useState<ConnectorTypeDefinition | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');

  const categories = ['All', ...Array.from(new Set(CONNECTOR_TYPES.map((c) => c.category)))];

  const filteredConnectors = connectors.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.category.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === 'All' || c.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const getIconName = (connectorType: string): string => {
    const def = CONNECTOR_TYPES.find((t) => t.type === connectorType);
    return def?.iconName || 'Globe';
  };

  return (
    <div style={{ display: 'flex', flex: 1, height: '100%', overflow: 'hidden' }}>
      {/* Main content */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'all 120ms ease-out',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px 16px',
          borderBottom: '1px solid #E2E8F0',
          backgroundColor: '#FFFFFF',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div>
              <h1 style={{ fontSize: '18px', fontWeight: 500, color: '#0D1117', marginBottom: '2px' }}>
                Connectors
              </h1>
              <p style={{ fontSize: '13px', color: '#64748B' }}>
                {connectors.length} configured · {connectors.filter(c => c.status === 'live' || c.status === 'active').length} active
              </p>
            </div>
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => setAddingType(CONNECTOR_TYPES[0])}>
              Add Connector
            </Button>
          </div>

          {/* Search + Filter */}
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1, maxWidth: '360px' }}>
              <Search size={14} style={{
                position: 'absolute', left: '10px', top: '50%',
                transform: 'translateY(-50%)', color: '#94A3B8',
              }} />
              <input
                type="text"
                placeholder="Search connectors..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  height: '32px',
                  paddingLeft: '32px',
                  paddingRight: '12px',
                  border: '1px solid #E2E8F0',
                  borderRadius: '4px',
                  fontSize: '13px',
                  color: '#0D1117',
                  backgroundColor: '#FFFFFF',
                  outline: 'none',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '4px' }}>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  style={{
                    height: '28px',
                    padding: '0 12px',
                    borderRadius: '2px',
                    border: `1px solid ${categoryFilter === cat ? '#2563EB' : '#E2E8F0'}`,
                    backgroundColor: categoryFilter === cat ? '#EFF6FF' : '#FFFFFF',
                    color: categoryFilter === cat ? '#1D4ED8' : '#64748B',
                    fontSize: '12px',
                    fontWeight: categoryFilter === cat ? 500 : 400,
                    cursor: 'pointer',
                    transition: 'all 80ms ease-out',
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Grid */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px',
        }}>
          {filteredConnectors.length === 0 ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '200px',
              color: '#94A3B8',
              gap: '8px',
            }}>
              <Search size={32} />
              <p style={{ fontSize: '14px' }}>No connectors match your search</p>
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: '12px',
            }}>
              {filteredConnectors.map((connector) => (
                <ConnectorCard
                  key={connector.id}
                  connector={connector}
                  iconName={getIconName(connector.type)}
                  onClick={setSelectedConnector}
                  onDelete={(c) => { removeConnector(c.id); if (selectedConnector?.id === c.id) setSelectedConnector(null); }}
                  selected={selectedConnector?.id === connector.id}
                />
              ))}
            </div>
          )}

          {/* Available connector types — always shown, add multiple instances */}
          <div style={{ marginTop: '32px' }}>
            <h2 style={{
              fontSize: '13px', fontWeight: 500, color: '#64748B',
              marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              Available Connector Types
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '8px' }}>
              {CONNECTOR_TYPES.map((ct) => {
                const existingCount = connectors.filter((c) => c.type === ct.type).length;
                return (
                  <div
                    key={ct.type}
                    onClick={() => setAddingType(ct)}
                    style={{
                      border: `1px dashed ${existingCount > 0 ? '#C4B5FD' : '#E2E8F0'}`,
                      borderRadius: '4px',
                      padding: '12px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      cursor: 'pointer',
                      transition: 'border-color 80ms, background-color 80ms',
                      backgroundColor: existingCount > 0 ? '#FAFAFE' : '#FAFAFA',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.borderColor = existingCount > 0 ? '#7C3AED' : '#CBD5E1';
                      (e.currentTarget as HTMLElement).style.backgroundColor = '#FFFFFF';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.borderColor = existingCount > 0 ? '#C4B5FD' : '#E2E8F0';
                      (e.currentTarget as HTMLElement).style.backgroundColor = existingCount > 0 ? '#FAFAFE' : '#FAFAFA';
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 500, color: '#64748B' }}>{ct.displayName}</div>
                      {existingCount > 0 && (
                        <div style={{ fontSize: '10px', color: '#7C3AED', marginTop: '1px' }}>
                          {existingCount} configured
                        </div>
                      )}
                    </div>
                    <div style={{
                      fontSize: '11px', color: existingCount > 0 ? '#7C3AED' : '#94A3B8',
                      border: `1px dashed ${existingCount > 0 ? '#C4B5FD' : '#CBD5E1'}`,
                      borderRadius: '2px', padding: '1px 6px', whiteSpace: 'nowrap', flexShrink: 0,
                    }}>
                      {existingCount > 0 ? '+ Add another' : '+ Add'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Detail panel */}
      {selectedConnector && (
        <ConnectorDetailPanel
          connector={selectedConnector}
          onClose={() => setSelectedConnector(null)}
        />
      )}

      {/* Add connector modal */}
      {addingType && addingType.type === 'POSTMAN' && (
        <PostmanConnectorModal onClose={() => setAddingType(null)} />
      )}
      {addingType && addingType.type !== 'POSTMAN' && (
        <AddConnectorModal
          connectorType={addingType}
          onClose={() => setAddingType(null)}
        />
      )}
    </div>
  );
};

export default ConnectorGrid;
