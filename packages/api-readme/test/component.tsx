import React, { FC } from 'react';

/**
 * configuration object
 */
type TConfig = {
  /**
   * is this a system configuration
   * @default true
   */
  system: boolean;
};
/**
 * MyComponent properties.
 */
type OwnProps = {
  /** stringProp description */
  stringProp?: string;

  /**
   * numberProp description
   * @default 4
   */
  numberProp: number;
  /**
   * objectProp description
   */
  objectProp: {
    name: string;
    sex: 'male' | 'female';
    c: TConfig;
  };
  /**
   * function property
   */
  fnProp: (p: { config: TConfig }) => { state: { name: string } };
  /**
   * array property
   */
  arrProp: [string, number];
};

/**
 * MyComponent special component
 */
export const MyComponent: FC<OwnProps> = ({ stringProp }) => (
  <div>{stringProp}</div>
);

MyComponent.defaultProps = {
  stringProp: 'test',
};
