export type CellKind = 'markdown' | 'python' | 'sql';

export type CellOutput = {
  status: 'ok' | 'error';
  outputs: { mime_type: string; data: unknown; stream?: string }[];
  error?: { ename: string; evalue: string; traceback: string[] };
  executed_at: string;
};

export interface Cell {
  id: string;
  kind: CellKind;
  source: string;
  output?: CellOutput;
  running?: boolean;
}

export interface Notebook {
  id: string;
  name: string;
  description: string;
  cells: Cell[];
  createdAt: string;
  updatedAt: string;
}
