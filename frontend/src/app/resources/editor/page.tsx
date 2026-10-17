'use client';
import { Suspense } from 'react';
import ResourceEditorPage from '@/components/resource-editor/resource-editor-page';
export default function Page() {
  return <Suspense fallback={<p>正在加载资源编辑器…</p>}><ResourceEditorPage /></Suspense>;
}
