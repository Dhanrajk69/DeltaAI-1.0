import React from 'react';
import { OrderForm } from './OrderForm';

export type ExecutionPadProps = React.ComponentProps<typeof OrderForm>;

export const ExecutionPad: React.FC<ExecutionPadProps> = (props) => {
  return <OrderForm {...props} />;
};

export default ExecutionPad;
