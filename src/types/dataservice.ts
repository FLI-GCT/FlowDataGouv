export interface Dataservice {
  id: string;
  title: string;
  description: string;
  organization?: string;
  base_api_url?: string;
  tags: string[];
  license?: string;
  created_at?: string;
  last_modified?: string;
}

export interface OpenApiEndpoint {
  method: string;
  path: string;
  description?: string;
  parameters?: { name: string; in: string; required: boolean; type?: string }[];
}
