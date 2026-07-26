import React from 'react';
import BatchPurchaseEditor, { BatchPurchaseEditorProps } from './BatchPurchaseEditor';

type BatchSalesEditorProps = Omit<BatchPurchaseEditorProps, 'mode'>;

export default function BatchSalesEditor(props: BatchSalesEditorProps) {
  return <BatchPurchaseEditor {...props} mode="sales" />;
}
