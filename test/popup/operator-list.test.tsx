import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OperatorList } from '../../entrypoints/popup/OperatorList.js';
import { makeOperator, ADDR_A } from '../fixtures.js';

const noopFavorites = { toggle: vi.fn(), isFavorite: () => false };
const noopSelect = vi.fn();

describe('OperatorList', () => {
  it('shows spinner when loading with no operators', () => {
    render(
      <OperatorList
        operators={[]}
        loading={true}
        favorites={noopFavorites}
        onSelect={noopSelect}
      />,
    );
    expect(screen.getByText('Loading operators...')).toBeInTheDocument();
  });

  it('does NOT show spinner when loading but operators already present', () => {
    const ops = [makeOperator({ id: '1' })];
    render(
      <OperatorList
        operators={ops}
        loading={true}
        favorites={noopFavorites}
        onSelect={noopSelect}
      />,
    );
    expect(screen.queryByText('Loading operators...')).not.toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
  });

  it('shows "No operators found" when empty and not loading', () => {
    render(
      <OperatorList
        operators={[]}
        loading={false}
        favorites={noopFavorites}
        onSelect={noopSelect}
      />,
    );
    expect(screen.getByText('No operators found')).toBeInTheDocument();
  });

  it('renders operator with #id header', () => {
    const ops = [makeOperator({ id: '42' })];
    render(
      <OperatorList
        operators={ops}
        loading={false}
        favorites={noopFavorites}
        onSelect={noopSelect}
      />,
    );
    expect(screen.getByText('#42')).toBeInTheDocument();
  });

  it('groups same address into single row with both MGR and RWD badges', () => {
    // manager and rewards are the same address
    const ops = [makeOperator({ id: '1', managerAddress: ADDR_A, rewardsAddress: ADDR_A })];
    render(
      <OperatorList
        operators={ops}
        loading={false}
        favorites={noopFavorites}
        onSelect={noopSelect}
      />,
    );
    expect(screen.getByText('MGR')).toBeInTheDocument();
    expect(screen.getByText('RWD')).toBeInTheDocument();
    // Only one address row (not two)
    const addressRows = screen.getAllByText(/0xaAaA\.\.\.aaAa/);
    expect(addressRows).toHaveLength(1);
  });

  it('shows owner badge based on extendedManagerPermissions', () => {
    const ops = [makeOperator({ id: '1', extendedManagerPermissions: true })];
    render(
      <OperatorList
        operators={ops}
        loading={false}
        favorites={noopFavorites}
        onSelect={noopSelect}
      />,
    );
    expect(screen.getByText('owner')).toBeInTheDocument();
  });

  it('shows filled star when favorite', () => {
    const ops = [makeOperator({ id: '1' })];
    const favorites = { toggle: vi.fn(), isFavorite: () => true };
    render(
      <OperatorList
        operators={ops}
        loading={false}
        favorites={favorites}
        onSelect={noopSelect}
      />,
    );
    expect(screen.getByText('\u2605')).toBeInTheDocument(); // ★
  });

  it('shows empty star when not favorite', () => {
    const ops = [makeOperator({ id: '1' })];
    render(
      <OperatorList
        operators={ops}
        loading={false}
        favorites={noopFavorites}
        onSelect={noopSelect}
      />,
    );
    expect(screen.getByText('\u2606')).toBeInTheDocument(); // ☆
  });
});
