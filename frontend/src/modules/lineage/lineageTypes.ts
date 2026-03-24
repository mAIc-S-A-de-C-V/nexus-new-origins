export interface LineageNode {
  id: string;
  type: 'CONNECTOR' | 'PIPELINE' | 'OBJECT_TYPE' | 'EVENT_LOG';
  label: string;
  description?: string;
  metadata?: Record<string, unknown>;
  position?: { x: number; y: number };
}

export interface LineageEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  transformationType?: 'extract' | 'transform' | 'load' | 'infer';
}

export interface LineageGraph {
  nodes: LineageNode[];
  edges: LineageEdge[];
  rootObjectTypeId?: string;
}
