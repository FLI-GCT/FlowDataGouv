export interface Dataset {
  id: string;
  title: string;
  description: string;
  organization?: string;
  tags: string[];
  resources_count: number;
  url: string;
  created_at?: string;
  last_modified?: string;
  license?: string;
  frequency?: string;
}

export interface Resource {
  id: string;
  title: string;
  format: string;
  filesize?: number;
  mime?: string;
  url: string;
  description?: string;
  tabular_api_available?: boolean;
}

export interface Metric {
  month: string;
  visits?: number;
  downloads?: number;
}
