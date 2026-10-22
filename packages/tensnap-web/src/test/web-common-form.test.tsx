import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import Form from '@tensnap/web-common/components/ui/Form';

afterEach(cleanup);

it('keeps a CSS color draft intact and updates it from the native picker', () => {
  function Editor() {
    const [value, setValue] = useState('#abc');
    return (
      <Form.Field label="Stroke" htmlFor="stroke">
        <Form.ColorInput
          id="stroke"
          pickerLabel="Choose stroke color"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </Form.Field>
    );
  }
  render(<Editor />);
  const text = screen.getByRole('textbox', { name: 'Stroke' });
  const picker = screen.getByLabelText('Choose stroke color');
  expect(text).toHaveValue('#abc');
  expect(picker).toHaveValue('#aabbcc');
  fireEvent.change(picker, { target: { value: '#123456' } });
  expect(text).toHaveValue('#123456');
  fireEvent.change(text, { target: { value: '#fed' } });
  expect(text).toHaveValue('#fed');
  expect(picker).toHaveValue('#ffeedd');
  fireEvent.change(text, { target: { value: 'rgba(66, 133, 244, 0.5)' } });
  expect(text).toHaveValue('rgba(66, 133, 244, 0.5)');
  expect(picker).toHaveValue('#4285f4');
});

it('cannot change a read-only color through its picker', () => {
  render(<Form.ColorInput value="#123456" readOnly pickerLabel="Choose color" />);
  expect(screen.getByLabelText('Choose color')).toBeDisabled();
  expect(screen.getByRole('textbox')).toHaveAttribute('readonly');
});
